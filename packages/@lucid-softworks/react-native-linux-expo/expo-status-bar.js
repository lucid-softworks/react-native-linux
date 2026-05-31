'use strict';

// Shim for the `expo-status-bar` module. On iOS/Android Expo's
// StatusBar configures the platform status bar (notch / signal /
// battery row); on a desktop GTK window there is no status bar to
// configure, so we render nothing. Keeping the module shape so
// drop-in Expo apps don't crash on the import.
const React = require('react');

function StatusBar() {
  return null;
}

function noop() {}

const api = {
  StatusBar,
  setStatusBarStyle: noop,
  setStatusBarHidden: noop,
  setStatusBarBackgroundColor: noop,
  setStatusBarNetworkActivityIndicatorVisible: noop,
  setStatusBarTranslucent: noop,
};

try {
  const {registerExpoModule} = require('./expo-modules-core');
  registerExpoModule('ExpoStatusBar', api);
} catch (_) {
  /* expo-modules-core not loaded in this context (in-tree unit test) */
}

module.exports = {
  ...api,
  __esModule: true,
  default: StatusBar,
};
