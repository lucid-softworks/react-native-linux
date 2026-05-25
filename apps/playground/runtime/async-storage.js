'use strict';

// AsyncStorage shim wrapping the synchronous rnLinux.storage* JSI
// bindings (which read/write a JSON file under XDG_CONFIG_HOME).
// We expose the standard async API anyway — callers get Promises
// they can await/then() so swapping in a real native backend later
// doesn't change the call sites.
//
// API covers what @react-native-async-storage/async-storage exports:
//   getItem(key)            → Promise<string | null>
//   setItem(key, value)     → Promise<void>
//   removeItem(key)         → Promise<void>
//   getAllKeys()            → Promise<string[]>
//   multiGet([k1, k2, ...]) → Promise<[[k, v], ...]>
//   multiSet([[k, v], ...]) → Promise<void>
//   multiRemove([...])      → Promise<void>
//   clear()                 → Promise<void>

function getItem(key) {
  return Promise.resolve(rnLinux.storageRead(key));
}

function setItem(key, value) {
  rnLinux.storageWrite(key, String(value));
  return Promise.resolve();
}

function removeItem(key) {
  rnLinux.storageRemove(key);
  return Promise.resolve();
}

function getAllKeys() {
  return Promise.resolve(rnLinux.storageKeys());
}

function multiGet(keys) {
  return Promise.resolve(keys.map((k) => [k, rnLinux.storageRead(k)]));
}

function multiSet(pairs) {
  for (const [k, v] of pairs) rnLinux.storageWrite(k, String(v));
  return Promise.resolve();
}

function multiRemove(keys) {
  for (const k of keys) rnLinux.storageRemove(k);
  return Promise.resolve();
}

function clear() {
  for (const k of rnLinux.storageKeys()) rnLinux.storageRemove(k);
  return Promise.resolve();
}

const AsyncStorage = {
  getItem, setItem, removeItem, getAllKeys,
  multiGet, multiSet, multiRemove, clear,
};

module.exports = AsyncStorage;
module.exports.default = AsyncStorage;
