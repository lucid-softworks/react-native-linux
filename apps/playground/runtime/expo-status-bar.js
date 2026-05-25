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

// expo-status-bar also exports `setStatusBarStyle`, `setStatusBarHidden`
// etc. as imperative API. Stub them so calls don't throw.
function noop() {}

module.exports = {
  StatusBar,
  setStatusBarStyle: noop,
  setStatusBarHidden: noop,
  setStatusBarBackgroundColor: noop,
  setStatusBarNetworkActivityIndicatorVisible: noop,
  setStatusBarTranslucent: noop,
  __esModule: true,
  default: StatusBar,
};
