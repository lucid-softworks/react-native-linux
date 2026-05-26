'use strict';

// Shim for `expo-location`. Backed by GeoClue2 via the native
// rnLinux.location* JSI bindings (vnext/src/location/*). The native
// side exposes a single GeoClue client; this shim multiplexes
// `watchPositionAsync` and `getCurrentPositionAsync` subscribers on
// top of it so the upstream API surface works unchanged.
//
// What's real vs not:
//   * permission requests always return `granted` — GeoClue's
//     authorization is gated at the system layer via
//     `/etc/geoclue/geoclue.conf` and an agent, not per-call prompts.
//     Apps that legitimately need to discover whether GeoClue is
//     reachable should call `hasServicesEnabledAsync`.
//   * geocode / reverseGeocode aren't backed — Linux doesn't ship a
//     standard reverse-geocoder, and expo upstream uses the same
//     Apple/Google services we don't want to wire by default. Both
//     return [] so callers that fan out to them don't crash.

const _hasNative =
  typeof rnLinux !== 'undefined' && typeof rnLinux.locationStartWatch === 'function';

// expo-location's Accuracy enum. Numeric values match upstream so
// switch-on-Accuracy in user code is portable.
const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
};

const PermissionStatus = {
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
};

const ActivityType = {
  Other: 1,
  AutomotiveNavigation: 2,
  Fitness: 3,
  OtherNavigation: 4,
  Airborne: 5,
};

const LocationAccuracy = Accuracy;
const LocationActivityType = ActivityType;
const LocationGeofencingEventType = {Enter: 1, Exit: 2};
const LocationGeofencingRegionState = {Unknown: 0, Inside: 1, Outside: 2};

// ─── Single shared native client ──────────────────────────────────
// GeoClue creates one Client per app; we wrap it so multiple JS
// `watchPositionAsync` calls share the underlying signal stream.
// Reference-counted: when the last subscriber removes, we stop the
// client; the next add restarts it.

let _watchActive = false;
let _nextId = 1;
const _subs = new Map(); // id -> {onFix, onErr}

function _toLocationObject(fix) {
  return {
    coords: {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy >= 0 ? fix.accuracy : null,
      altitude: fix.altitude,
      altitudeAccuracy: null,
      heading: fix.heading >= 0 ? fix.heading : null,
      speed: fix.speed >= 0 ? fix.speed : null,
    },
    timestamp: fix.timestamp,
    mocked: false,
  };
}

function _fanFix(fix) {
  const loc = _toLocationObject(fix);
  // Persist every fix to disk so getLastKnownPositionAsync has
  // something to return between app launches. Writes happen on the
  // JS thread but the C++ side uses an atomic rename so a crash
  // mid-write can't truncate the cache to zero bytes.
  _persistLastKnown(loc);
  for (const s of _subs.values()) {
    try {
      s.onFix(loc);
    } catch (e) {
      // Swallow per-subscriber throws — one bad callback shouldn't
      // sever the stream for everyone else.
    }
  }
}

function _fanErr(msg) {
  // Errors fire once per failed start. Drain pending one-shots
  // (getCurrentPositionAsync) by rejecting them; long-lived watchers
  // get the error too but stay subscribed in case the user retries.
  for (const s of _subs.values()) {
    try {
      s.onErr?.(msg);
    } catch (e) {}
  }
}

function _ensureWatch() {
  if (_watchActive || !_hasNative) return;
  _watchActive = rnLinux.locationStartWatch(_fanFix, _fanErr);
}

function _maybeStop() {
  if (_subs.size === 0 && _watchActive) {
    rnLinux.locationStopWatch();
    _watchActive = false;
  }
}

function _addSub(onFix, onErr) {
  const id = _nextId++;
  _subs.set(id, {onFix, onErr});
  _ensureWatch();
  return id;
}

function _removeSub(id) {
  _subs.delete(id);
  _maybeStop();
}

// ─── Permissions ───────────────────────────────────────────────────
// GeoClue authorization happens at the system layer, not per-call.
// We surface "granted" so apps proceed to the actual location call,
// where any real failure surfaces as a `services-unavailable` error.

async function getForegroundPermissionsAsync() {
  return {
    status: PermissionStatus.GRANTED,
    granted: true,
    canAskAgain: true,
    expires: 'never',
  };
}

async function requestForegroundPermissionsAsync() {
  return getForegroundPermissionsAsync();
}

// Background permission semantics map to the same thing on desktop —
// there's no app-state lifecycle that gates location updates.
async function getBackgroundPermissionsAsync() {
  return getForegroundPermissionsAsync();
}

async function requestBackgroundPermissionsAsync() {
  return getForegroundPermissionsAsync();
}

async function hasServicesEnabledAsync() {
  if (!_hasNative) return false;
  return Boolean(rnLinux.locationIsAvailable());
}

async function enableNetworkProviderAsync() {
  return undefined;
}

// ─── One-shot position ─────────────────────────────────────────────
// Start a watch, resolve on the first fix, drop the subscription.
// GeoClue typically delivers within ~200ms when the agent + static
// source are already wired; in cold-start scenarios it can take a
// few seconds for the first signal. Honors `accuracy` only loosely —
// the underlying GeoClue daemon picks sources, not us.

async function getCurrentPositionAsync(_options) {
  if (!_hasNative) {
    throw new Error('expo-location: native rnLinux.location* not bound');
  }
  return new Promise((resolve, reject) => {
    const id = _addSub(
      loc => {
        _removeSub(id);
        resolve(loc);
      },
      msg => {
        _removeSub(id);
        reject(new Error(msg));
      },
    );
  });
}

// Per-process memoized snapshot so successive calls inside the same
// JS lifetime don't bounce through fsReadString. Loaded lazily on
// first read; written to on every persisted fix via _persistLastKnown.
let _lastKnownCache;
let _lastKnownLoaded = false;

function _cachePath() {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.fsConstants !== 'function') return null;
  const dir = rnLinux.fsConstants().cacheDirectory || '';
  if (!dir) return null;
  return dir.replace('file://', '') + 'expo-location-last.json';
}

function _persistLastKnown(loc) {
  _lastKnownCache = loc;
  _lastKnownLoaded = true;
  const path = _cachePath();
  if (!path || typeof rnLinux.fsWriteString !== 'function') return;
  try {
    rnLinux.fsWriteString(path, JSON.stringify(loc), 'utf8');
  } catch (_) {
    // Cache writes are best-effort; an EBUSY / ENOSPC shouldn't
    // poison the live stream the caller cares about.
  }
}

function _loadLastKnown() {
  if (_lastKnownLoaded) return _lastKnownCache;
  _lastKnownLoaded = true;
  const path = _cachePath();
  if (!path || typeof rnLinux.fsReadString !== 'function') return undefined;
  try {
    const raw = rnLinux.fsReadString(path, 'utf8');
    if (!raw) return undefined;
    _lastKnownCache = JSON.parse(raw);
    return _lastKnownCache;
  } catch (_) {
    return undefined;
  }
}

async function getLastKnownPositionAsync(options) {
  const cached = _loadLastKnown();
  if (!cached) return null;
  const maxAge = options && typeof options.maxAge === 'number' ? options.maxAge : null;
  if (maxAge !== null && typeof cached.timestamp === 'number') {
    if (Date.now() - cached.timestamp > maxAge) return null;
  }
  const requiredAccuracy =
    options && typeof options.requiredAccuracy === 'number' ? options.requiredAccuracy : null;
  if (requiredAccuracy !== null) {
    const acc = cached.coords && cached.coords.accuracy;
    if (typeof acc !== 'number' || acc > requiredAccuracy) return null;
  }
  return cached;
}

// ─── Continuous watch ──────────────────────────────────────────────

async function watchPositionAsync(_options, callback) {
  if (!_hasNative) {
    throw new Error('expo-location: native rnLinux.location* not bound');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('watchPositionAsync requires a callback');
  }
  const id = _addSub(
    loc => callback(loc),
    () => {},
  );
  return {
    remove() {
      _removeSub(id);
    },
  };
}

// Heading / compass — no Linux equivalent on desktop hardware; expose
// the API surface so apps that wire it up don't throw, but never emit.
async function watchHeadingAsync(callback) {
  return {
    remove() {},
  };
}

async function getHeadingAsync() {
  return {trueHeading: 0, magHeading: 0, accuracy: 0};
}

// ─── Geocoding stubs ───────────────────────────────────────────────
// Real expo-location relies on iOS CLGeocoder / Android Geocoder
// (which themselves talk to Apple/Google). Returning empty arrays
// matches the upstream "no result" path.

async function geocodeAsync(_address) {
  return [];
}

async function reverseGeocodeAsync(_coords) {
  return [];
}

// ─── Background task / geofencing stubs ────────────────────────────

async function startLocationUpdatesAsync(_taskName, _options) {
  return undefined;
}
async function stopLocationUpdatesAsync(_taskName) {
  return undefined;
}
async function hasStartedLocationUpdatesAsync(_taskName) {
  return false;
}
async function startGeofencingAsync(_taskName, _regions) {
  return undefined;
}
async function stopGeofencingAsync(_taskName) {
  return undefined;
}
async function hasStartedGeofencingAsync(_taskName) {
  return false;
}

// ─── Provider availability info ────────────────────────────────────

async function getProviderStatusAsync() {
  const available = await hasServicesEnabledAsync();
  return {
    locationServicesEnabled: available,
    backgroundModeEnabled: available,
    gpsAvailable: false,
    networkAvailable: available,
    passiveAvailable: false,
  };
}

const api = {
  Accuracy,
  LocationAccuracy,
  ActivityType,
  LocationActivityType,
  LocationGeofencingEventType,
  LocationGeofencingRegionState,
  PermissionStatus,
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync,
  getBackgroundPermissionsAsync,
  requestBackgroundPermissionsAsync,
  hasServicesEnabledAsync,
  enableNetworkProviderAsync,
  getCurrentPositionAsync,
  getLastKnownPositionAsync,
  watchPositionAsync,
  watchHeadingAsync,
  getHeadingAsync,
  geocodeAsync,
  reverseGeocodeAsync,
  startLocationUpdatesAsync,
  stopLocationUpdatesAsync,
  hasStartedLocationUpdatesAsync,
  startGeofencingAsync,
  stopGeofencingAsync,
  hasStartedGeofencingAsync,
  getProviderStatusAsync,
  // expo-location also exports these constants directly:
  GeofencingEventType: LocationGeofencingEventType,
  GeofencingRegionState: LocationGeofencingRegionState,
};

module.exports = api;
module.exports.default = api;
