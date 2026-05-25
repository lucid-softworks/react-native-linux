// Tiny entry used to prove the Metro resolver swaps `expo-status-bar`
// for our umbrella-package shim when `--platform linux`. Run via
// scripts/test-metro-resolve.mjs at the repo root — the output bundle
// must contain `setStatusBarTranslucent`, the shim's signature export.

const ExpoStatusBar = require('expo-status-bar');

// Force the shim's exported names into the bundle so dead-code
// elimination can't strip them.
module.exports = {
  StatusBar: ExpoStatusBar.StatusBar,
  setStatusBarStyle: ExpoStatusBar.setStatusBarStyle,
  setStatusBarHidden: ExpoStatusBar.setStatusBarHidden,
  setStatusBarTranslucent: ExpoStatusBar.setStatusBarTranslucent,
};
