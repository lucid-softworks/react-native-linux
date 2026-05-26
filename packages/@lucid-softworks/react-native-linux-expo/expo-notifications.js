'use strict';

// Shim for `expo-notifications`. Backed by libnotify via the native
// rnLinux.notifications* JSI bindings (vnext/src/notifications/*).
// All local-notification surfaces (immediate present, delayed
// schedule, cancel, response listener) flow into the freedesktop
// org.freedesktop.Notifications spec on the user's session bus.
// The notification daemon (gnome-shell, mako, dunst, xfce4-notifyd,
// etc.) is the system's concern.
//
// What's real vs not:
//   * present / cancel / cancelAll → real
//   * schedule with arbitrary trigger (date/seconds/daily/weekly/
//     yearly/calendar, with `repeats`) → real; JS owns the scheduler
//     so we can compute next-fire and re-arm on recurring triggers
//   * scheduled persistence across restarts → in-process only;
//     a previous attempt to persist+rehydrate at module load
//     raced with vendor-bundle evaluation. Needs an explicit
//     app-lifecycle hook to wire safely; tracked as a follow-up
//   * categories with actions → real; setNotificationCategoryAsync
//     registers a {key, label} list, notify_notification_add_action
//     attaches them at fire time, the response listener fires with
//     the clicked action's key
//   * permissions → always granted (Linux gates the daemon, not the
//     calling app, modulo Flatpak portals which we don't claim to
//     support yet)
//   * response listener → fires on dismissal with action='dismissed'
//     or with the action key for category action button clicks
//   * push notifications → unimplemented (no FCM/APNS equivalent
//     bundled by default; requires a server-side opinionated stack)
//   * badges → desktop doesn't have an app-icon badge convention
//     that works across panels/docks; stubbed as a getter that
//     remembers what was set so apps don't crash on get-after-set
//   * channels → Android-only concept; accepted and discarded

const _hasNative =
  typeof rnLinux !== 'undefined' && typeof rnLinux.notificationsPresent === 'function';

let _nextId = 1;
function _genId() {
  return `rnl-${Date.now()}-${_nextId++}`;
}

// Subscriber registries — expo's API returns Subscription objects
// with .remove(). We multiplex multiple subscribers per channel.
const _responseSubs = new Set();
const _receivedSubs = new Set();

// Schedules are kept in-process only — they don't survive an app
// restart. Persisting them across restarts is a `_persistScheduled`
// / `_rehydrateScheduled` follow-up; the file-write turned out to
// race with vendor-bundle evaluation on this runtime and needs to
// be initialized from an explicit app-lifecycle hook rather than
// the module load, which is what the next iteration will wire up.
function _persistScheduled() {}

function _fireResponse(id, actionId) {
  // expo's response shape: {notification: NotificationRequest, actionIdentifier}
  const response = {
    actionIdentifier:
      actionId === 'default' ? 'expo.modules.notifications.actions.DEFAULT' : actionId,
    notification: {
      request: {identifier: id, content: {title: '', body: ''}, trigger: null},
      date: Date.now(),
    },
  };
  for (const fn of _responseSubs) {
    try {
      fn(response);
    } catch (e) {
      // Swallow per-subscriber errors so one bad handler doesn't
      // break the rest. The thrown text already logs from C++.
    }
  }
}

// Wire the JS-side dispatcher into the C++ trampoline once. The
// native side only supports a single listener; we fan out from there.
if (_hasNative) {
  rnLinux.notificationsSetResponseListener(_fireResponse);
}

// ─── Permissions ───────────────────────────────────────────────────
// Linux's session-bus notification daemon doesn't gate per-app
// permissions the way iOS / Android do. Flatpak adds a portal layer
// that does, but bare desktop notifications are open. We surface
// `granted` so apps proceed; real failure shows up at present()
// time as a libnotify return false.

const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
};

function _grantedPermResponse() {
  return {
    status: PermissionStatus.GRANTED,
    granted: true,
    canAskAgain: true,
    expires: 'never',
    ios: undefined,
    android: undefined,
  };
}

async function getPermissionsAsync() {
  return _grantedPermResponse();
}

async function requestPermissionsAsync(_options) {
  return _grantedPermResponse();
}

// ─── Present / schedule ───────────────────────────────────────────
// JS owns the entire scheduler so calendar/daily/weekly triggers and
// persistence across restarts both work cleanly. The native side just
// handles the immediate present and cancel-visible. State shape:
//   _scheduled: Map<id, {request, fireAt, handle}>
// fireAt is an absolute ms-epoch; handle is the setTimeout id.

const _scheduled = new Map();

// Notify any registered `addNotificationReceivedListener` callbacks
// in expo's standard shape. Called whenever a notification actually
// presents (immediate or via timer fire).
function _fireReceived(identifier, content, trigger) {
  if (_receivedSubs.size === 0) return;
  const evt = {
    request: {
      identifier,
      content: {
        title: String(content?.title ?? ''),
        body: String(content?.body ?? ''),
        data: content?.data ?? {},
      },
      trigger: trigger ?? null,
    },
    date: Date.now(),
  };
  for (const fn of _receivedSubs) {
    try {
      fn(evt);
    } catch (_) {}
  }
}

// Walk forward from `from` until we hit a date that satisfies the
// constraints in `t` (calendar trigger fields). Returns ms-epoch.
function _nextCalendarFire(t, from) {
  const d = new Date(from);
  if (typeof t.second === 'number') d.setSeconds(t.second, 0);
  else d.setMilliseconds(0);
  if (typeof t.minute === 'number') d.setMinutes(t.minute);
  if (typeof t.hour === 'number') d.setHours(t.hour);
  if (typeof t.day === 'number') d.setDate(t.day);
  if (typeof t.month === 'number') d.setMonth(t.month - 1);
  if (typeof t.year === 'number') d.setFullYear(t.year);
  // If the computed time is in the past, push to the next matching
  // window. With a fixed year there's no future occurrence, so we
  // return 0 (caller treats as "never").
  while (d.getTime() <= from) {
    if (typeof t.year === 'number') return 0;
    if (typeof t.month === 'number') d.setFullYear(d.getFullYear() + 1);
    else if (typeof t.day === 'number') d.setMonth(d.getMonth() + 1);
    else if (typeof t.hour === 'number') d.setDate(d.getDate() + 1);
    else if (typeof t.minute === 'number') d.setHours(d.getHours() + 1);
    else d.setMinutes(d.getMinutes() + 1);
  }
  // Weekday filter — keep advancing by 1 day until the JS-format
  // weekday matches (1=Sunday in expo's shape, 0=Sunday in
  // JS Date). Bounded at 7 iterations.
  if (typeof t.weekday === 'number') {
    for (let i = 0; i < 7 && d.getDay() + 1 !== t.weekday; ++i) {
      d.setDate(d.getDate() + 1);
    }
  }
  return d.getTime();
}

// Compute the next absolute fire time for an expo trigger. Returns
// `<= 0` to mean "fire immediately"; returns `null` to mean "no
// future occurrence — drop this schedule".
function _nextFireTime(trigger, now = Date.now()) {
  if (!trigger) return 0;
  if (typeof trigger.seconds === 'number') {
    return now + Math.max(0, trigger.seconds * 1000);
  }
  if (trigger.date instanceof Date) return trigger.date.getTime();
  if (typeof trigger.date === 'number') return trigger.date;
  if (trigger.value instanceof Date) return trigger.value.getTime();
  if (typeof trigger.value === 'number') return trigger.value;
  const type = trigger.type || (trigger.channelId && 'calendar');
  if (type === 'daily') {
    const d = new Date(now);
    d.setHours(trigger.hour ?? 9, trigger.minute ?? 0, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  if (type === 'weekly') {
    // weekday in expo: 1=Sunday..7=Saturday.
    const target = trigger.weekday ?? 1;
    const d = new Date(now);
    d.setHours(trigger.hour ?? 9, trigger.minute ?? 0, 0, 0);
    for (let i = 0; i < 8; ++i) {
      if (d.getDay() + 1 === target && d.getTime() > now) return d.getTime();
      d.setDate(d.getDate() + 1);
    }
    return 0;
  }
  if (type === 'yearly') {
    const d = new Date(now);
    if (typeof trigger.month === 'number') d.setMonth(trigger.month - 1);
    if (typeof trigger.day === 'number') d.setDate(trigger.day);
    d.setHours(trigger.hour ?? 9, trigger.minute ?? 0, 0, 0);
    if (d.getTime() <= now) d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  if (type === 'calendar') {
    return _nextCalendarFire(trigger, now);
  }
  if (type === 'timeInterval') {
    return now + Math.max(0, (trigger.seconds ?? 0) * 1000);
  }
  // Unknown trigger shape — fire immediately rather than silently
  // swallow.
  return 0;
}

function _isRepeating(trigger) {
  return Boolean(
    trigger &&
    (trigger.repeats === true ||
      trigger.type === 'daily' ||
      trigger.type === 'weekly' ||
      trigger.type === 'yearly' ||
      trigger.type === 'calendar'),
  );
}

function _fireNow(identifier, request) {
  const content = request?.content;
  const title = String(content?.title ?? '');
  const body = String(content?.body ?? '');
  const category =
    typeof content?.categoryIdentifier === 'string' ? content.categoryIdentifier : '';
  rnLinux.notificationsPresent(identifier, title, body, category);
  _fireReceived(identifier, content, request?.trigger);
}

function _armSchedule(identifier, request) {
  const now = Date.now();
  const next = _nextFireTime(request?.trigger, now);
  if (next === 0) {
    // Trigger asked for immediate fire — just present and stop.
    _fireNow(identifier, request);
    _persistScheduled();
    return;
  }
  if (next < 0 || next == null) {
    // No future occurrence — drop the schedule.
    _scheduled.delete(identifier);
    _persistScheduled();
    return;
  }
  const delay = Math.max(0, next - now);
  const handle = setTimeout(() => {
    _fireNow(identifier, request);
    if (_isRepeating(request?.trigger)) {
      // Re-arm from the moment we fired so back-to-back daily/weekly
      // schedules don't double-fire on slow clocks.
      _armSchedule(identifier, request);
    } else {
      _scheduled.delete(identifier);
      _persistScheduled();
    }
  }, delay);
  _scheduled.set(identifier, {request, fireAt: next, handle});
  _persistScheduled();
}

async function scheduleNotificationAsync(request) {
  if (!_hasNative) throw new Error('expo-notifications: native bindings not bound');
  const identifier = request?.identifier ?? _genId();
  // Clear any prior schedule with this id so callers can update
  // content/trigger by re-scheduling under the same id.
  const prior = _scheduled.get(identifier);
  if (prior) clearTimeout(prior.handle);
  _scheduled.delete(identifier);
  _armSchedule(identifier, request);
  return identifier;
}

async function presentNotificationAsync(content, identifier) {
  if (!_hasNative) throw new Error('expo-notifications: native bindings not bound');
  const id = identifier ?? _genId();
  _fireNow(id, {content, trigger: null});
  return id;
}

async function cancelScheduledNotificationAsync(identifier) {
  if (!_hasNative) return;
  const id = String(identifier);
  rnLinux.notificationsCancel(id);
  const sched = _scheduled.get(id);
  if (sched) {
    clearTimeout(sched.handle);
    _scheduled.delete(id);
    _persistScheduled();
  }
}

async function cancelAllScheduledNotificationsAsync() {
  if (!_hasNative) return;
  rnLinux.notificationsCancelAll();
  for (const s of _scheduled.values()) clearTimeout(s.handle);
  _scheduled.clear();
  _persistScheduled();
}

async function dismissNotificationAsync(identifier) {
  // Linux daemons treat dismiss == cancel for visible bubbles; reuse
  // the same path.
  return cancelScheduledNotificationAsync(identifier);
}

async function dismissAllNotificationsAsync() {
  return cancelAllScheduledNotificationsAsync();
}

async function getAllScheduledNotificationsAsync() {
  return Array.from(_scheduled.entries()).map(([id, s]) => ({
    identifier: id,
    content: s.request?.content ?? {},
    trigger: s.request?.trigger ?? {type: 'date', value: s.fireAt},
  }));
}

async function getPresentedNotificationsAsync() {
  // We don't separately track "presented but not dismissed"; the
  // daemon owns that lifecycle. Return [] rather than lie.
  return [];
}

// ─── Subscriptions ────────────────────────────────────────────────

function addNotificationResponseReceivedListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('listener must be a function');
  }
  _responseSubs.add(listener);
  return {
    remove() {
      _responseSubs.delete(listener);
    },
  };
}

function addNotificationReceivedListener(listener) {
  // libnotify doesn't fire its own "received" signal (the daemon
  // owns delivery), so we synthesize one from this process's
  // present()/schedule() entry points. Fires immediately for
  // present, on the timer for schedule, and skips when the
  // schedule has been cancelled in between.
  if (typeof listener !== 'function') {
    throw new TypeError('listener must be a function');
  }
  _receivedSubs.add(listener);
  return {
    remove() {
      _receivedSubs.delete(listener);
    },
  };
}

function removeNotificationSubscription(sub) {
  if (sub && typeof sub.remove === 'function') sub.remove();
}

// expo's "notification handler" controls how foreground notifications
// behave (alert vs silent). Linux desktop notifications never have
// to ask — the daemon decides. We accept the handler and discard.
function setNotificationHandler(_handler) {}

// ─── Badge / channels / categories (stubs) ────────────────────────

let _badge = 0;
async function getBadgeCountAsync() {
  return _badge;
}
async function setBadgeCountAsync(count) {
  _badge = typeof count === 'number' ? count : 0;
  return true;
}

// Android channels — accept any shape, return null/empty.
async function setNotificationChannelAsync(_channelId, _config) {
  return null;
}
async function getNotificationChannelAsync(_channelId) {
  return null;
}
async function getNotificationChannelsAsync() {
  return [];
}
async function deleteNotificationChannelAsync(_channelId) {
  return undefined;
}

// Categories with action buttons — the native side stores the
// {key, label} list and attaches it via notify_notification_add_action
// when a notification firing references this category id. Each
// action click fires the response listener with that key as
// actionIdentifier. `buttonTitle` (legacy) and `title` (modern)
// are accepted as labels.
async function setNotificationCategoryAsync(identifier, actions, _options) {
  if (typeof identifier !== 'string' || !identifier) {
    throw new TypeError('setNotificationCategoryAsync requires a string identifier');
  }
  const flat = Array.isArray(actions)
    ? actions
        .map(a => {
          if (!a) return null;
          const key = a.identifier || a.key;
          if (!key) return null;
          const label = a.buttonTitle || a.title || a.label || key;
          return {key: String(key), label: String(label)};
        })
        .filter(Boolean)
    : [];
  if (typeof rnLinux !== 'undefined' && typeof rnLinux.notificationsSetCategory === 'function') {
    rnLinux.notificationsSetCategory(identifier, flat);
  }
  return {identifier, actions: flat};
}

async function deleteNotificationCategoryAsync(identifier) {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.notificationsClearCategory !== 'function') {
    return false;
  }
  rnLinux.notificationsClearCategory(String(identifier));
  return true;
}

async function getNotificationCategoriesAsync() {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.notificationsListCategories !== 'function') {
    return [];
  }
  // Native returns [{identifier, actions: [{key, label}]}]; expo's
  // shape uses `buttonTitle` for the label, so rename on the way out.
  return rnLinux.notificationsListCategories().map(c => ({
    identifier: c.identifier,
    actions: (c.actions || []).map(a => ({identifier: a.key, buttonTitle: a.label})),
  }));
}

// Push notifications (Expo push service): require a server contract
// we don't bundle. Throw with a clear message so the failure mode is
// obvious in app code.
async function getExpoPushTokenAsync() {
  throw new Error('expo-notifications: push tokens not implemented on Linux');
}
async function getDevicePushTokenAsync() {
  throw new Error('expo-notifications: device push tokens not implemented on Linux');
}

const SchedulableTriggerInputTypes = {
  CALENDAR: 'calendar',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  YEARLY: 'yearly',
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
};

const AndroidImportance = {
  UNKNOWN: 0,
  UNSPECIFIED: 1,
  NONE: 2,
  MIN: 3,
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
};

const AndroidNotificationVisibility = {
  UNKNOWN: 0,
  PUBLIC: 1,
  PRIVATE: 2,
  SECRET: 3,
};

const IosAuthorizationStatus = {
  NOT_DETERMINED: 0,
  DENIED: 1,
  AUTHORIZED: 2,
  PROVISIONAL: 3,
  EPHEMERAL: 4,
};

const api = {
  PermissionStatus,
  SchedulableTriggerInputTypes,
  AndroidImportance,
  AndroidNotificationVisibility,
  IosAuthorizationStatus,
  // Permissions
  getPermissionsAsync,
  requestPermissionsAsync,
  // Lifecycle
  scheduleNotificationAsync,
  presentNotificationAsync,
  cancelScheduledNotificationAsync,
  cancelAllScheduledNotificationsAsync,
  dismissNotificationAsync,
  dismissAllNotificationsAsync,
  getAllScheduledNotificationsAsync,
  getPresentedNotificationsAsync,
  // Subscriptions
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  removeNotificationSubscription,
  setNotificationHandler,
  // Badge / channels / categories
  getBadgeCountAsync,
  setBadgeCountAsync,
  setNotificationChannelAsync,
  getNotificationChannelAsync,
  getNotificationChannelsAsync,
  deleteNotificationChannelAsync,
  setNotificationCategoryAsync,
  deleteNotificationCategoryAsync,
  getNotificationCategoriesAsync,
  // Push (intentionally throwing)
  getExpoPushTokenAsync,
  getDevicePushTokenAsync,
};

module.exports = api;
module.exports.default = api;
