'use strict';

// Shim for `expo-cellular`. Cellular is a telephony concept — Linux
// desktops don't have a SIM card or cellular modem. We match
// upstream's own behavior on non-Android platforms (iOS/web):
//
//   * `getCellularGenerationAsync()` → CellularGeneration.UNKNOWN
//   * Data getters (carrier, MCC, MNC, etc.) → null
//   * Permissions → always granted (no phone-state permission)
//
// Cross-platform code that checks generation/carrier gracefully
// handles the "no data" case naturally.

const CellularGeneration = {
  UNKNOWN: 0,
  CELLULAR_2G: 1,
  CELLULAR_3G: 2,
  CELLULAR_4G: 3,
  CELLULAR_5G: 4,
};

async function getCellularGenerationAsync() {
  return CellularGeneration.UNKNOWN;
}

async function allowsVoipAsync() {
  return null;
}

async function getIsoCountryCodeAsync() {
  return null;
}

async function getCarrierNameAsync() {
  return null;
}

async function getMobileCountryCodeAsync() {
  return null;
}

async function getMobileNetworkCodeAsync() {
  return null;
}

function _granted() {
  return {
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  };
}

async function getPermissionsAsync() {
  return _granted();
}

async function requestPermissionsAsync() {
  return _granted();
}

function usePermissions() {
  return [_granted(), requestPermissionsAsync, getPermissionsAsync];
}

const api = {
  CellularGeneration,
  getCellularGenerationAsync,
  allowsVoipAsync,
  getIsoCountryCodeAsync,
  getCarrierNameAsync,
  getMobileCountryCodeAsync,
  getMobileNetworkCodeAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  usePermissions,
};

try {
  const {registerExpoModule} = require('./expo-modules-core');
  registerExpoModule('ExpoCellular', api);
} catch (_) {
  /* expo-modules-core not loaded in this context */
}

module.exports = api;
module.exports.default = api;
