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

function setOptions(_options) {}

const api = {
  preventAutoHideAsync,
  hideAsync,
  setOptions,
};

try {
  const {registerExpoModule} = require('./expo-modules-core');
  registerExpoModule('ExpoSplashScreen', api);
} catch (_) {
  /* expo-modules-core not loaded in this context (in-tree unit test) */
}

module.exports = api;
