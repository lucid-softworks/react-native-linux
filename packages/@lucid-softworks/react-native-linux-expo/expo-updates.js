'use strict';

// expo-updates shim. Real implementation talks to EAS Update for
// OTA bundle delivery; we don't have an update channel on Linux.
// Static metadata (channel, runtimeVersion, etc.) returns null
// values, and `checkForUpdateAsync` resolves with isAvailable=false
// so apps that gate UI on update state render their initial screen.

Object.defineProperty(module.exports, '__esModule', {value: true});

module.exports.isEnabled = false;
module.exports.channel = null;
module.exports.runtimeVersion = null;
module.exports.updateId = null;
module.exports.createdAt = null;
module.exports.manifest = null;
module.exports.releaseChannel = 'default';

module.exports.checkForUpdateAsync = function () {
  return Promise.resolve({isAvailable: false, manifest: null});
};
module.exports.fetchUpdateAsync = function () {
  return Promise.resolve({isNew: false, manifest: null});
};
module.exports.reloadAsync = function () {
  return Promise.resolve();
};
module.exports.addListener = function () {
  return {remove() {}};
};
module.exports.useUpdates = function () {
  return {
    currentlyRunning: {channel: null, runtimeVersion: null, updateId: null},
    isUpdateAvailable: false,
    isUpdatePending: false,
    isChecking: false,
    isDownloading: false,
    availableUpdate: null,
    downloadedUpdate: null,
    checkError: null,
    downloadError: null,
    initializationError: null,
    lastCheckForUpdateTimeSinceRestart: null,
  };
};
module.exports.UpdateEventType = {
  UPDATE_AVAILABLE: 'updateAvailable',
  NO_UPDATE_AVAILABLE: 'noUpdateAvailable',
  ERROR: 'error',
};
