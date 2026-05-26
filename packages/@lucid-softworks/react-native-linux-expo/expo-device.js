'use strict';

// Shim for `expo-device`. All fields come off the existing DeviceInfo
// JSI snapshot — same data, reshaped under expo-device's API names.
//
// On Linux every field has a meaningful answer (no "this iOS device's
// model is iPhone17,3" guesswork): brand from DMI, model from DMI,
// osName from /etc/os-release, kernel build from uname. Where the
// kernel doesn't expose something (modelId, designName, platformApiLevel
// — Android-only concepts), we return null per upstream's contract.

const _snap = (() => {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.deviceInfoSync !== 'function') return {};
  try {
    return rnLinux.deviceInfoSync();
  } catch (_) {
    return {};
  }
})();

const DeviceType = {
  UNKNOWN: 0,
  PHONE: 1,
  TABLET: 2,
  DESKTOP: 3,
  TV: 4,
};

// Linux desktops and laptops both fall under DESKTOP. Tablets running
// Linux are rare but increasing; we don't try to detect them from
// kernel signals (there's no portable "is tablet" probe). Real apps
// can branch on form factor via window aspect ratio if they care.
const deviceType = DeviceType.DESKTOP;

const isDevice = !_snap.isEmulator;
const brand = _snap.brand || null;
const manufacturer = _snap.manufacturer || null;
const modelName = _snap.model || null;
// Android-only fields: leave null. designName is e.g. "marlin" on a
// Pixel — no Linux equivalent.
const modelId = null;
const designName = null;
const productName = _snap.product || _snap.model || null;
const deviceYearClass = null;
const totalMemory = typeof _snap.totalMemory === 'number' ? _snap.totalMemory : null;
// `uname -m` lands in DeviceInfo as `arch`; expo expects an array
// (Android's getSupportedAbis is the source).
const supportedCpuArchitectures = _snap.arch ? [_snap.arch] : null;
const osName = _snap.systemName || 'Linux';
const osVersion = _snap.systemVersion || null;
const osBuildId = _snap.kernelVersion || null;
const osInternalBuildId = _snap.kernelVersion || null;
const osBuildFingerprint = _snap.kernelVersion || null;
// platformApiLevel is Android-only (e.g. 34 for SDK 34). No Linux
// analog — null per upstream's web behavior.
const platformApiLevel = null;
const deviceName = _snap.deviceName || _snap.hostname || null;

async function getDeviceTypeAsync() {
  return deviceType;
}

async function getUptimeAsync() {
  // Match expo's return type (milliseconds). /proc/uptime returns
  // seconds; the JSI side hands us seconds.
  if (typeof _snap.uptimeSeconds === 'number') return _snap.uptimeSeconds * 1000;
  return 0;
}

async function getMaxMemoryAsync() {
  return totalMemory != null ? totalMemory : 0;
}

async function isRootedExperimentalAsync() {
  // Linux equivalent of "rooted" is "running as uid 0". Most apps
  // explicitly don't, and the few that do (system tools) wouldn't be
  // calling expo-device. Heuristic check against $USER.
  if (typeof process !== 'undefined' && process.env && process.env.USER === 'root') return true;
  return false;
}

async function isSideLoadingEnabledAsync() {
  // Android-only concept. Linux has no managed-install layer to
  // bypass, so semantically "sideloading" is always on. Return true
  // for honesty.
  return true;
}

async function getPlatformFeaturesAsync() {
  // Android's PackageManager.FEATURE_* list has no Linux analog.
  // Return [] so cross-platform code that intersects against
  // this list just gets no-op.
  return [];
}

async function hasPlatformFeatureAsync(_feature) {
  return false;
}

const api = {
  DeviceType,
  isDevice,
  brand,
  manufacturer,
  modelId,
  modelName,
  designName,
  productName,
  deviceType,
  deviceYearClass,
  totalMemory,
  supportedCpuArchitectures,
  osName,
  osVersion,
  osBuildId,
  osInternalBuildId,
  osBuildFingerprint,
  platformApiLevel,
  deviceName,
  getDeviceTypeAsync,
  getUptimeAsync,
  getMaxMemoryAsync,
  isRootedExperimentalAsync,
  isSideLoadingEnabledAsync,
  getPlatformFeaturesAsync,
  hasPlatformFeatureAsync,
};

module.exports = api;
module.exports.default = api;
