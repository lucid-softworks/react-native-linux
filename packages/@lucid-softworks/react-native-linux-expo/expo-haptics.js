'use strict';

// Shim for `expo-haptics`. Desktop hardware has no haptics motor;
// gdk_display_beep on the default display is the closest analog
// — the WM / sound theme decides whether to play a sound, flash
// the title bar, or do nothing. On a Lima VM with no audio sink
// it's effectively a no-op, but the API still fires successfully
// so cross-platform code doesn't throw.
//
// All "feedback" styles route through the same beep on Linux —
// the distinction between Light/Medium/Heavy is an iOS Taptic
// Engine concept that has no GTK equivalent. We could vary
// behavior by style (e.g. multiple beeps for Heavy, none for
// Light) but that mostly produces an annoying user experience
// rather than a useful one; one beep per call matches what most
// freedesktop bell users expect.

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.haptic === 'function';

function _beep() {
  if (_hasNative) rnLinux.haptic();
}

async function impactAsync(_style) {
  _beep();
}

async function notificationAsync(_type) {
  _beep();
}

async function selectionAsync() {
  _beep();
}

// expo-haptics' enums. String values match upstream so any
// switch-on-style in user code keeps working.
const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Soft: 'soft',
  Rigid: 'rigid',
};

const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
};

const AndroidHaptics = {
  Confirm: 0,
  ContextClick: 1,
  GestureEnd: 2,
  GestureStart: 3,
  KeyboardPress: 4,
  KeyboardRelease: 5,
  KeyboardTap: 6,
  LongPress: 7,
  NoHapticsRipple: 8,
  Reject: 9,
  SegmentFrequentTick: 10,
  SegmentTick: 11,
  TextHandleMove: 12,
  Toggle: 13,
  VirtualKey: 14,
  VirtualKeyRelease: 15,
};

async function performAndroidHapticsAsync(_kind) {
  _beep();
}

const api = {
  impactAsync,
  notificationAsync,
  selectionAsync,
  performAndroidHapticsAsync,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  AndroidHaptics,
};

module.exports = api;
module.exports.default = api;
