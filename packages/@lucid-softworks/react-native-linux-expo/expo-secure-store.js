'use strict';

// Shim for `expo-secure-store`. Backed by libsecret via the
// rnLinux.secureStore* JSI bindings (vnext/src/securestore/*).
// libsecret talks to whichever org.freedesktop.secrets daemon is
// running on the session bus — gnome-keyring, kwallet, KeePassXC,
// etc. The user's keyring handles encryption + on-disk
// persistence; we just key into the default ("login") collection
// with a stable schema. Headless sessions without a login keyring
// fall back transparently to the in-memory session collection.
//
// What's real vs not:
//   * set/get/delete: real round-trip through the keyring daemon
//   * isAvailableAsync: real bus-name check
//   * options.keychainService / keychainAccessible / requireAuthentication:
//     iOS-specific. Accepted and discarded — Linux secret service
//     entries aren't grouped by an external service name, and the
//     daemon decides locking behavior, not the calling app.

const _hasNative =
  typeof rnLinux !== 'undefined' && typeof rnLinux.secureStoreSetItem === 'function';

function _assert() {
  if (!_hasNative) {
    throw new Error('expo-secure-store: native rnLinux.secureStore* not bound');
  }
}

async function isAvailableAsync() {
  return _hasNative && Boolean(rnLinux.secureStoreIsAvailable());
}

async function setItemAsync(key, value, _options) {
  _assert();
  if (typeof key !== 'string' || !key) {
    throw new TypeError('setItemAsync: key must be a non-empty string');
  }
  rnLinux.secureStoreSetItem(key, String(value ?? ''));
}

async function getItemAsync(key, _options) {
  _assert();
  if (typeof key !== 'string' || !key) {
    throw new TypeError('getItemAsync: key must be a non-empty string');
  }
  // C++ side returns null for missing entries; preserve that so
  // consumers branching on `=== null` work unchanged.
  return rnLinux.secureStoreGetItem(key);
}

async function deleteItemAsync(key, _options) {
  _assert();
  if (typeof key !== 'string' || !key) {
    throw new TypeError('deleteItemAsync: key must be a non-empty string');
  }
  rnLinux.secureStoreDeleteItem(key);
}

// Sync variants — expo-secure-store ships these for some SDK
// versions. The native side is already sync; just call through.
function setItem(key, value, options) {
  _assert();
  if (typeof key !== 'string' || !key) {
    throw new TypeError('setItem: key must be a non-empty string');
  }
  rnLinux.secureStoreSetItem(key, String(value ?? ''));
  // Match upstream signature — historically returned `void` but
  // newer SDKs return a Promise even from the "sync" variant.
  return options?._async ? Promise.resolve() : undefined;
}

function getItem(key) {
  _assert();
  if (typeof key !== 'string' || !key) {
    throw new TypeError('getItem: key must be a non-empty string');
  }
  return rnLinux.secureStoreGetItem(key);
}

function deleteItem(key) {
  _assert();
  rnLinux.secureStoreDeleteItem(key);
}

// expo-secure-store enums for iOS keychain-accessible flags. They
// don't affect Linux behavior — the daemon decides locking. Expose
// them so cross-platform code that switches on them compiles + runs.
const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK';
const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';
const ALWAYS = 'ALWAYS';
const ALWAYS_THIS_DEVICE_ONLY = 'ALWAYS_THIS_DEVICE_ONLY';
const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY';
const WHEN_UNLOCKED = 'WHEN_UNLOCKED';
const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';

// canUseBiometricAuthentication — Linux secret-service has no
// universal biometric prompt; some daemons (KWallet) can ask via
// PAM but no portable API exists. Return false so cross-platform
// code that gates on this skips the biometric path.
async function canUseBiometricAuthentication() {
  return false;
}

const api = {
  isAvailableAsync,
  setItemAsync,
  getItemAsync,
  deleteItemAsync,
  setItem,
  getItem,
  deleteItem,
  canUseBiometricAuthentication,
  AFTER_FIRST_UNLOCK,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  ALWAYS,
  ALWAYS_THIS_DEVICE_ONLY,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  WHEN_UNLOCKED,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

module.exports = api;
module.exports.default = api;
