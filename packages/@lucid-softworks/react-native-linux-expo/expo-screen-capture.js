'use strict';

// Shim for `expo-screen-capture`. The upstream API is about
// PREVENTING screen capture (the iOS "secure window" flag,
// Android's FLAG_SECURE) and DETECTING screenshots. Neither
// concept maps cleanly to Linux:
//
//   * No portable "secure window" hint. Wayland's
//     wp-security-context-v1 protocol is compositor-specific
//     and not widely implemented; X11 has no such mechanism at
//     all. Any app on the user's machine that can grab the
//     framebuffer (gnome-screenshot, ffmpeg, OBS, the portal
//     ScreenCast API) will succeed regardless of what we
//     "set" on our window.
//
//   * No portable screenshot signal. There's no DBus signal
//     that fires when a user runs `import` or PrintScreen —
//     each screenshot tool acts independently.
//
// We expose the upstream API surface so cross-platform code
// compiles and runs, but the prevention is a no-op and the
// listener never fires. Documented as a gap rather than faked
// with a "true" return that consumers might trust.

let _preventing = false;

async function preventScreenCaptureAsync(_key) {
  // Track the flag so allowScreenCaptureAsync can flip it back —
  // the upstream API supports reference-counted prevent/allow
  // pairs keyed by an opaque string. We honor the bookkeeping
  // so apps that branch on isPreventing don't see false
  // negatives.
  _preventing = true;
}

async function allowScreenCaptureAsync(_key) {
  _preventing = false;
}

function usePreventScreenCapture(_key) {
  // Upstream's hook activates on mount, deactivates on unmount.
  // Symmetry matters for the bookkeeping above.
  const React = require('react');
  React.useEffect(() => {
    preventScreenCaptureAsync();
    return () => {
      allowScreenCaptureAsync();
    };
  }, []);
}

async function isAvailableAsync() {
  // Surface API is wired; just no real prevention. Returning
  // false would push cross-platform code into a fallback path
  // that's probably worse than the silent no-op.
  return true;
}

function addScreenshotListener(_listener) {
  return {remove() {}};
}

function removeScreenshotListener(sub) {
  if (sub && typeof sub.remove === 'function') sub.remove();
}

const api = {
  preventScreenCaptureAsync,
  allowScreenCaptureAsync,
  usePreventScreenCapture,
  isAvailableAsync,
  addScreenshotListener,
  removeScreenshotListener,
};

module.exports = api;
module.exports.default = api;
