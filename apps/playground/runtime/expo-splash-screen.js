'use strict';

// Shim for `expo-splash-screen`. On iOS/Android this controls the
// native splash image that shows before JS loads. Our GTK4 window
// boots straight into the first paint with no native splash phase,
// so every call is a no-op that resolves.

function preventAutoHideAsync() {
  return Promise.resolve(true);
}

function hideAsync() {
  return Promise.resolve(true);
}

function setOptions(_options) {
  // expo-splash-screen has an options API (fade, duration, etc.).
  // Nothing to do here.
}

module.exports = {
  preventAutoHideAsync,
  hideAsync,
  setOptions,
};
