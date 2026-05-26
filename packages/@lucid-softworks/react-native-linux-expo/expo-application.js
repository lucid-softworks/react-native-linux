'use strict';

// Shim for `expo-application`. App identity (name, id, version, build)
// and install/update timestamps. On iOS/Android these come from
// Info.plist / AndroidManifest.xml; on Linux we read from the
// process's environment and the executable's metadata.
//
// Most fields map directly to data the existing DeviceInfo native
// module already pulls (XDG application id from the executable's
// basename, env vars for version markers). The Android-specific
// fingerprint (`getAndroidId`) intentionally throws — Linux's
// `/etc/machine-id` is the closest analog but it's *not* per-app, so
// surfacing it under the Android name would be misleading.

const _snap = (() => {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.deviceInfoSync !== 'function') return {};
  try {
    return rnLinux.deviceInfoSync();
  } catch (_) {
    return {};
  }
})();

// XDG application id — for the playground it's `rn-linux-playground`.
// Apps set this via the `id` field in `app.json` (mirrors Android's
// `applicationId` / iOS's `CFBundleIdentifier`). Fall through to the
// process name when no app config is loaded.
const applicationId =
  (typeof process !== 'undefined' && process.env && process.env.RN_LINUX_APP_ID) ||
  _snap.appId ||
  _snap.bundleId ||
  null;

const applicationName =
  (typeof process !== 'undefined' && process.env && process.env.RN_LINUX_APP_NAME) ||
  _snap.appName ||
  null;

// expo's app.json `version` lands in the runtime via the bundle
// build step; we read from RN_LINUX_APP_VERSION when the host
// passes it through, otherwise null (matches web platform).
const nativeApplicationVersion =
  (typeof process !== 'undefined' && process.env && process.env.RN_LINUX_APP_VERSION) || null;

const nativeBuildVersion =
  (typeof process !== 'undefined' && process.env && process.env.RN_LINUX_APP_BUILD) || null;

// /etc/machine-id is per-installation, not per-app. Surfacing it
// under getAndroidId would be misleading — that ID is specifically
// scoped to {app-signing-key, user, device}. Throw instead so
// cross-platform code that calls this on Linux fails loudly.
function getAndroidId() {
  throw new Error('expo-application.getAndroidId is Android-only');
}

async function getInstallReferrerAsync() {
  // Android Play-Store-only concept; no equivalent on Linux.
  return '';
}

async function getIosIdForVendorAsync() {
  return null;
}

const ApplicationReleaseType = {
  UNKNOWN: 0,
  SIMULATOR: 1,
  ENTERPRISE: 2,
  DEVELOPMENT: 3,
  AD_HOC: 4,
  APP_STORE: 5,
};

async function getIosApplicationReleaseTypeAsync() {
  return ApplicationReleaseType.UNKNOWN;
}

async function getIosPushNotificationServiceEnvironmentAsync() {
  return null;
}

// Best-effort install + update times: the mtime of the running
// executable. For development builds these are roughly "when the
// dev built the bundle"; for installed apps they're "when the
// install landed on disk". Returns the epoch as a fallback so the
// Promise contract holds.
async function getInstallationTimeAsync() {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.fsGetInfo !== 'function') {
    return new Date(0);
  }
  try {
    const exe = '/proc/self/exe';
    const info = rnLinux.fsGetInfo(exe, false);
    if (info && info.modificationTime) {
      // fsGetInfo returns modificationTime in seconds (per the shim
      // contract); Date wants ms.
      return new Date(info.modificationTime * 1000);
    }
  } catch (_) {}
  return new Date(0);
}

async function getLastUpdateTimeAsync() {
  // Same heuristic as install time — the binary's mtime advances on
  // each `cp` / package upgrade.
  return getInstallationTimeAsync();
}

const api = {
  nativeApplicationVersion,
  nativeBuildVersion,
  applicationName,
  applicationId,
  getAndroidId,
  getInstallReferrerAsync,
  getIosIdForVendorAsync,
  getIosApplicationReleaseTypeAsync,
  getIosPushNotificationServiceEnvironmentAsync,
  getInstallationTimeAsync,
  getLastUpdateTimeAsync,
  ApplicationReleaseType,
};

module.exports = api;
module.exports.default = api;
