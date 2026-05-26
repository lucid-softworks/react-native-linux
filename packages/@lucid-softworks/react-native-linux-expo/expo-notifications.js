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
//   * present / schedule / cancel / cancelAll → real
//   * permissions → always granted (Linux gates the daemon, not the
//     calling app, modulo Flatpak portals which we don't claim to
//     support yet)
//   * response listener → fires on dismissal with action='dismissed'
//   * push notifications → unimplemented (no FCM/APNS equivalent
//     bundled by default; requires a server-side opinionated stack)
//   * categories with actions → libnotify supports actions but the
//     full expo categories API needs more plumbing; stubbed
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
// Pending JS-side timers for scheduled-but-not-yet-fired received-
// listener emissions. Keyed by identifier so cancel() can clear them.
const _pendingReceived = new Map();

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
// expo's request shape is `{content: {title, body, data, ...},
// trigger: {seconds: 5} | {date: Date} | null | DateTrigger | …}`.
// We honor `title`, `body`, and translate the trigger into our
// delayMs (or fire-now if null/missing).

function _triggerToDelayMs(trigger) {
  if (!trigger) return 0;
  if (typeof trigger.seconds === 'number') return Math.max(0, trigger.seconds * 1000);
  if (trigger.date instanceof Date) {
    return Math.max(0, trigger.date.getTime() - Date.now());
  }
  if (typeof trigger.date === 'number') {
    return Math.max(0, trigger.date - Date.now());
  }
  // Calendar / daily / weekly triggers — not implemented. Fire now
  // so the call doesn't silently swallow.
  return 0;
}

// Notify any registered `addNotificationReceivedListener` callbacks
// in expo's standard shape. Fired from the present/schedule paths
// after the libnotify call lands, plus after the timer fires for
// scheduled deliveries.
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

async function scheduleNotificationAsync(request) {
  if (!_hasNative) throw new Error('expo-notifications: native bindings not bound');
  const identifier = request?.identifier ?? _genId();
  const title = String(request?.content?.title ?? '');
  const body = String(request?.content?.body ?? '');
  const delay = _triggerToDelayMs(request?.trigger);
  if (delay <= 0) {
    rnLinux.notificationsPresent(identifier, title, body);
    _fireReceived(identifier, request?.content, request?.trigger);
  } else {
    rnLinux.notificationsSchedule(identifier, delay, title, body);
    // Mirror the native timer in JS so the received-listener fires
    // when the bubble actually shows up. The native cancel path
    // doesn't currently call back through to JS, so a cancellation
    // followed by the timer landing here would over-fire; tracked
    // by id so cancel() can clear the pending entry too.
    const handle = setTimeout(() => {
      _pendingReceived.delete(identifier);
      _fireReceived(identifier, request?.content, request?.trigger);
    }, delay);
    _pendingReceived.set(identifier, handle);
  }
  return identifier;
}

// Older RFC name — present immediately, no scheduling.
async function presentNotificationAsync(content, identifier) {
  if (!_hasNative) throw new Error('expo-notifications: native bindings not bound');
  const id = identifier ?? _genId();
  rnLinux.notificationsPresent(id, String(content?.title ?? ''), String(content?.body ?? ''));
  _fireReceived(id, content, null);
  return id;
}

async function cancelScheduledNotificationAsync(identifier) {
  if (!_hasNative) return;
  const id = String(identifier);
  rnLinux.notificationsCancel(id);
  const pending = _pendingReceived.get(id);
  if (pending !== undefined) {
    clearTimeout(pending);
    _pendingReceived.delete(id);
  }
}

async function cancelAllScheduledNotificationsAsync() {
  if (!_hasNative) return;
  rnLinux.notificationsCancelAll();
  for (const h of _pendingReceived.values()) clearTimeout(h);
  _pendingReceived.clear();
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
  if (!_hasNative) return [];
  const list = rnLinux.notificationsListScheduled();
  return list.map(h => ({
    identifier: h.id,
    content: {title: h.title, body: h.body, data: {}},
    trigger: {type: 'date', value: h.fireAt},
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

// Categories with actions — partial support possible via libnotify
// add_action; full expo categories API (button labels, destructive,
// authentication required) needs more wiring. Stubbed for now.
async function setNotificationCategoryAsync(_identifier, _actions) {
  return null;
}
async function deleteNotificationCategoryAsync(_identifier) {
  return false;
}
async function getNotificationCategoriesAsync() {
  return [];
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
