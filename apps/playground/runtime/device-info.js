'use strict';

// Drop-in replacement for `react-native-device-info` backed by the
// rnLinux.deviceInfoSync() JSI binding (vnext/src/deviceinfo/*).
// Wraps every getter the upstream library exposes so apps don't
// have to special-case Linux. Async variants resolve immediately —
// gather() in C++ is a one-shot file-read; there's no I/O cost to
// amortize across an event loop tick.
//
// We re-call deviceInfoSync() per access so dynamic fields (battery,
// memory, disk) stay live. Static fields (brand, model, kernel) read
// the same file every call, which is cheap (sysfs reads hit page
// cache) and avoids the cache-invalidation traps a snapshot-once
// design would invite.

function _snapshot() {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.deviceInfoSync !== 'function') {
    return {};
  }
  return rnLinux.deviceInfoSync();
}

// Helpers: sync getter (returns immediately), async getter (returns
// Promise<value>). Both pull from a fresh snapshot.
const _sync = key => () => _snapshot()[key];
const _async = key => () => Promise.resolve(_snapshot()[key]);

// PowerState — RN's API returns batteryLevel, batteryState (charging
// / discharging / full / unknown), lowPowerMode. We return the
// snapshot's `powerState` sub-object directly.
function getPowerState() {
  return Promise.resolve(_snapshot().powerState || {});
}
function getPowerStateSync() {
  return _snapshot().powerState || {};
}

// Battery level is exposed both as a top-level method AND as a sub-
// field of powerState. RN apps reach for both forms; we delegate
// both to the same snapshot.
function getBatteryLevel() {
  const ps = _snapshot().powerState || {};
  return Promise.resolve(typeof ps.batteryLevel === 'number' ? ps.batteryLevel : -1);
}
function getBatteryLevelSync() {
  const ps = _snapshot().powerState || {};
  return typeof ps.batteryLevel === 'number' ? ps.batteryLevel : -1;
}

// Free disk storage: RN's API accepts an optional "storageType"
// (important | total) — both fall through to the same root mount
// here. Linux doesn't surface a per-iOS-purpose split.
function getFreeDiskStorage() {
  return Promise.resolve(_snapshot().freeDiskStorage);
}
function getFreeDiskStorageSync() {
  return _snapshot().freeDiskStorage;
}
function getTotalDiskCapacity() {
  return Promise.resolve(_snapshot().totalDiskCapacity);
}
function getTotalDiskCapacitySync() {
  return _snapshot().totalDiskCapacity;
}

// supportedAbis returns the host's machine type (x86_64 / aarch64).
// Linux doesn't enumerate 32-bit ABIs separately the way Android JNI
// does; getSupported32BitAbis / Sync return [] for that reason.
function getSupportedAbis() {
  return Promise.resolve(_snapshot().supportedAbis || []);
}
function getSupportedAbisSync() {
  return _snapshot().supportedAbis || [];
}

// readableVersion is the conventional "version.build" join callers
// drop into about screens — match RN's exact format.
function getReadableVersion() {
  const s = _snapshot();
  return `${s.version}.${s.buildNumber}`;
}

// hostNames is a string[] (Windows / iOS surface multiple aliases);
// on Linux we report one entry (the kernel-reported nodename).
function getHostNames() {
  return Promise.resolve(_snapshot().hostNames || []);
}
function getHostNamesSync() {
  return _snapshot().hostNames || [];
}

// Unsupported on Linux but defined in the upstream type so callers
// using TypeScript don't pay the cost of `?.()` on every call.
// Returns "" / 0 / [] / false matching what RN does on platforms
// where the platform doesn't surface the underlying API.
function _stubAsync(value) {
  return () => Promise.resolve(value);
}
function _stubSync(value) {
  return () => value;
}

// Every export the upstream library publishes. Order matches the
// docs table so it's easy to audit which are real vs stubbed.
const api = {
  // ─ Identifiers ────────────────────────────────────────────────
  getApplicationName: _sync('applicationName'),
  getBrand: _sync('brand'),
  getBuildId: _async('buildId'),
  getBuildIdSync: _sync('buildId'),
  getBundleId: _sync('bundleId'),
  getDeviceId: _sync('deviceId'),
  getDeviceName: _async('deviceName'),
  getDeviceNameSync: _sync('deviceName'),
  getManufacturer: _async('manufacturer'),
  getManufacturerSync: _sync('manufacturer'),
  getModel: _sync('model'),
  getProduct: _async('product'),
  getProductSync: _sync('product'),
  getSerialNumber: _async('serialNumber'),
  getSerialNumberSync: _sync('serialNumber'),
  getUniqueId: _async('uniqueId'),
  getUniqueIdSync: _sync('uniqueId'),
  getInstanceId: _async('instanceId'),
  getInstanceIdSync: _sync('instanceId'),

  // ─ OS / kernel ────────────────────────────────────────────────
  getBaseOs: _async('baseOs'),
  getBaseOsSync: _sync('baseOs'),
  getSystemName: _sync('systemName'),
  getSystemVersion: _sync('systemVersion'),
  getFingerprint: _async('fingerprint'),
  getFingerprintSync: _sync('fingerprint'),
  getCodename: _async('codename'),
  getCodenameSync: _sync('codename'),
  getHardware: _async('hardware'),
  getHardwareSync: _sync('hardware'),
  getBootloader: _async('bootloader'),
  getBootloaderSync: _sync('bootloader'),

  // ─ App identity ───────────────────────────────────────────────
  getVersion: _sync('version'),
  getBuildNumber: _sync('buildNumber'),
  getReadableVersion,
  getInstallerPackageName: _async('installerPackageName'),
  getInstallerPackageNameSync: _sync('installerPackageName'),

  // ─ Network ────────────────────────────────────────────────────
  getIpAddress: _async('ipAddress'),
  getIpAddressSync: _sync('ipAddress'),
  getMacAddress: _async('macAddress'),
  getMacAddressSync: _sync('macAddress'),
  getHost: _async('host'),
  getHostSync: _sync('host'),
  getHostNames,
  getHostNamesSync,
  getCarrier: _async('carrier'),
  getCarrierSync: _sync('carrier'),

  // ─ Memory ─────────────────────────────────────────────────────
  getTotalMemory: _async('totalMemory'),
  getTotalMemorySync: _sync('totalMemory'),
  getMaxMemory: _async('maxMemory'),
  getMaxMemorySync: _sync('maxMemory'),
  getUsedMemory: _async('usedMemory'),
  getUsedMemorySync: _sync('usedMemory'),

  // ─ Disk ──────────────────────────────────────────────────────
  getFreeDiskStorage,
  getFreeDiskStorageSync,
  getFreeDiskStorageOld: getFreeDiskStorage,
  getFreeDiskStorageOldSync: getFreeDiskStorageSync,
  getTotalDiskCapacity,
  getTotalDiskCapacitySync,
  getTotalDiskCapacityOld: getTotalDiskCapacity,
  getTotalDiskCapacityOldSync: getTotalDiskCapacitySync,

  // ─ Power ─────────────────────────────────────────────────────
  getPowerState,
  getPowerStateSync,
  getBatteryLevel,
  getBatteryLevelSync,
  isBatteryCharging: () => Promise.resolve(_snapshot().isBatteryCharging),
  isBatteryChargingSync: () => _snapshot().isBatteryCharging,

  // ─ Form factor / capabilities ─────────────────────────────────
  isTablet: _sync('isTablet'),
  isEmulator: _async('isEmulator'),
  isEmulatorSync: _sync('isEmulator'),
  isCameraPresent: _async('isCameraPresent'),
  isCameraPresentSync: _sync('isCameraPresent'),
  isLandscape: _async('isLandscape'),
  isLandscapeSync: _sync('isLandscape'),
  isKeyboardConnected: _async('isKeyboardConnected'),
  isKeyboardConnectedSync: _sync('isKeyboardConnected'),
  isMouseConnected: _async('isMouseConnected'),
  isMouseConnectedSync: _sync('isMouseConnected'),
  hasNotch: _sync('hasNotch'),
  hasDynamicIsland: _sync('hasDynamicIsland'),
  getDeviceType: _sync('isTablet') /* simplified */ ? () => 'Tablet' : () => 'Desktop',
  getFontScale: _async('fontScale'),
  getFontScaleSync: _sync('fontScale'),

  // ─ Times ─────────────────────────────────────────────────────
  getFirstInstallTime: _async('firstInstallTime'),
  getFirstInstallTimeSync: _sync('firstInstallTime'),
  getLastUpdateTime: _async('lastUpdateTime'),
  getLastUpdateTimeSync: _sync('lastUpdateTime'),
  getStartupTime: _async('startupTime'),
  getStartupTimeSync: _sync('startupTime'),

  // ─ ABIs ──────────────────────────────────────────────────────
  supportedAbis: getSupportedAbis,
  supportedAbisSync: getSupportedAbisSync,
  getSupportedAbis,
  getSupportedAbisSync,
  getSupported32BitAbis: _stubAsync([]),
  getSupported32BitAbisSync: _stubSync([]),
  getSupported64BitAbis: getSupportedAbis,
  getSupported64BitAbisSync: getSupportedAbisSync,

  // ─ Linux-not-applicable stubs (Android-only surface) ──────────
  getAndroidId: _stubAsync(''),
  getAndroidIdSync: _stubSync(''),
  getApiLevel: _stubAsync(-1),
  getApiLevelSync: _stubSync(-1),
  getDevice: _stubAsync(''),
  getDeviceSync: _stubSync(''),
  getDisplay: _stubAsync(''),
  getDisplaySync: _stubSync(''),
  getFontScale: _async('fontScale'),
  getIncremental: _stubAsync(''),
  getIncrementalSync: _stubSync(''),
  getInstallReferrer: _stubAsync(''),
  getInstallReferrerSync: _stubSync(''),
  getPreviewSdkInt: _stubAsync(-1),
  getPreviewSdkIntSync: _stubSync(-1),
  getSecurityPatch: _stubAsync(''),
  getSecurityPatchSync: _stubSync(''),
  getSystemAvailableFeatures: _stubAsync([]),
  getSystemAvailableFeaturesSync: _stubSync([]),
  getTags: _stubAsync(''),
  getTagsSync: _stubSync(''),
  getType: _stubAsync(''),
  getTypeSync: _stubSync(''),
  hasGms: _stubAsync(false),
  hasHms: _stubAsync(false),
  hasSystemFeature: _stubAsync(false),
  hasSystemFeatureSync: _stubSync(false),
  isLowRamDevice: _stubSync(false),
  isDisplayZoomed: _stubSync(false),
  isPinOrFingerprintSet: _stubAsync(false),
  isPinOrFingerprintSetSync: _stubSync(false),
  isAirplaneMode: _stubAsync(false),
  isLocationEnabled: _stubAsync(true),
  isHeadphonesConnected: _stubAsync(false),
  isWiredHeadphonesConnected: _stubAsync(false),
  isBluetoothHeadphonesConnected: _stubAsync(false),
  syncUniqueId: _async('uniqueId'),
  getUserAgent: _stubAsync(''),
  getUserAgentSync: _stubSync(''),
  getInstallerPackage: _async('installerPackageName'),
  getAvailableLocationProviders: _stubAsync({}),
  getDeviceToken: _stubAsync(''),
  getBrightness: _stubAsync(-1),
  isTabletMode: _stubAsync(false),
  getAppSetId: _stubAsync({id: '', scope: 'app'}),
  getSupportedMediaTypeList: _stubAsync([]),

  // ─ Event subscriptions ────────────────────────────────────────
  // Power / battery events would normally come from a NativeEventEmitter
  // on RNDeviceInfo; until we add a polling-or-sysfs-watcher path,
  // these are no-op subscriptions so consuming code can register/clean
  // up without crashing.
  addBatteryLevelListener: () => ({remove: () => {}}),
  addBatteryLevelChangeListener: () => ({remove: () => {}}),
  addPowerStateListener: () => ({remove: () => {}}),
  addHeadphonesConnectedListener: () => ({remove: () => {}}),
  removeAllListeners: () => {},
  useBatteryLevel: () => -1,
  useBatteryLevelIsLow: () => -1,
  usePowerState: () => ({batteryLevel: -1, batteryState: 'unknown', lowPowerMode: false}),
  useFirstInstallTime: () => 0,
  useDeviceName: () => '',
  useManufacturer: () => '',
  useIsEmulator: () => false,
  useHasSystemFeature: () => false,
  useIsHeadphonesConnected: () => false,
  useBrightness: () => -1,
};

module.exports = api;
module.exports.default = api;
