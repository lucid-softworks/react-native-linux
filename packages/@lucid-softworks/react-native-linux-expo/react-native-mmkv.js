'use strict';

// Shim for `react-native-mmkv`. MMKV's distinguishing feature is
// synchronous get/set — Hermes apps can read config in a render
// without an await. We back with the existing rnLinux.storage* JSI
// bindings, which are also sync (sit on top of the same JSON file
// AsyncStorage uses, namespaced per instance id).
//
// Encryption is not implemented — XDG storage already lives inside
// the user's home directory and the typical threat model for MMKV
// encryption is "stolen unlocked phone unlocks the app's data
// directory". Linux's per-user file perms already gate that. The
// `recrypt` call no-ops; an explicit warning would be too noisy
// since cross-platform code may call it unconditionally.

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.storageRead === 'function';

// Listener registry per instance id — MMKV's contract is "any value
// changing fires every listener". We mirror that. Cross-process
// notifications aren't implemented (single-process by definition on
// our runtime).
const _listenersById = new Map();

function _namespace(id) {
  return `mmkv::${id || 'mmkv.default'}::`;
}

// Storage values are stored as strings; we tag the original type
// with a single-character prefix so getString/getNumber/getBoolean/
// getBuffer can round-trip without ambiguity. 'S' = string,
// 'N' = number (JSON.stringify), 'B' = bool, 'X' = ArrayBuffer
// (base64 of the bytes). Older values without a prefix are returned
// as strings — this is a fresh codebase but the prefix system also
// keeps the JSON store readable when poked with `cat`.
function _encode(value) {
  if (typeof value === 'string') return 'S' + value;
  if (typeof value === 'number') return 'N' + String(value);
  if (typeof value === 'boolean') return 'B' + (value ? '1' : '0');
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const view =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < view.length; i += chunk) {
      bin += String.fromCharCode.apply(
        null,
        view.subarray ? view.subarray(i, i + chunk) : Array.from(view.slice(i, i + chunk)),
      );
    }
    return 'X' + globalThis.btoa(bin);
  }
  throw new TypeError('MMKV.set: value must be string, number, boolean, or ArrayBuffer');
}

function _decodeString(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  return raw[0] === 'S' ? raw.slice(1) : raw;
}

function _decodeNumber(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  if (raw[0] !== 'N') return undefined;
  const n = Number(raw.slice(1));
  return Number.isFinite(n) ? n : undefined;
}

function _decodeBool(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  if (raw[0] !== 'B') return undefined;
  return raw[1] === '1';
}

function _decodeBuffer(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  if (raw[0] !== 'X') return undefined;
  const bin = globalThis.atob(raw.slice(1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const Mode = {
  SINGLE_PROCESS: 0,
  MULTI_PROCESS: 1,
};

class MMKV {
  constructor(configuration) {
    const id = (configuration && configuration.id) || 'mmkv.default';
    this._id = id;
    this._ns = _namespace(id);
    this._readOnly = Boolean(configuration && configuration.readOnly);
  }

  get isReadOnly() {
    return this._readOnly;
  }

  // Total bytes stored under this namespace. Walks getAllKeys and
  // sums the raw value lengths — not the cheapest but matches MMKV's
  // "estimate of disk footprint" semantics.
  get size() {
    let total = 0;
    for (const k of this.getAllKeys()) {
      const raw = rnLinux.storageRead(this._ns + k);
      if (typeof raw === 'string') total += raw.length;
    }
    return total;
  }

  set(key, value) {
    if (this._readOnly) throw new Error('MMKV: instance is read-only');
    if (!_hasNative) return;
    rnLinux.storageWrite(this._ns + key, _encode(value));
    this._notifyChanged(key);
  }

  getString(key) {
    if (!_hasNative) return undefined;
    return _decodeString(rnLinux.storageRead(this._ns + key));
  }

  getNumber(key) {
    if (!_hasNative) return undefined;
    return _decodeNumber(rnLinux.storageRead(this._ns + key));
  }

  getBoolean(key) {
    if (!_hasNative) return undefined;
    return _decodeBool(rnLinux.storageRead(this._ns + key));
  }

  getBuffer(key) {
    if (!_hasNative) return undefined;
    return _decodeBuffer(rnLinux.storageRead(this._ns + key));
  }

  contains(key) {
    if (!_hasNative) return false;
    const raw = rnLinux.storageRead(this._ns + key);
    return typeof raw === 'string' && raw.length > 0;
  }

  delete(key) {
    if (this._readOnly) throw new Error('MMKV: instance is read-only');
    if (!_hasNative) return;
    rnLinux.storageRemove(this._ns + key);
    this._notifyChanged(key);
  }

  getAllKeys() {
    if (!_hasNative || typeof rnLinux.storageKeys !== 'function') return [];
    const all = rnLinux.storageKeys();
    const out = [];
    const prefix = this._ns;
    for (const k of all) {
      if (typeof k === 'string' && k.startsWith(prefix)) {
        out.push(k.slice(prefix.length));
      }
    }
    return out;
  }

  clearAll() {
    if (this._readOnly) throw new Error('MMKV: instance is read-only');
    if (!_hasNative) return;
    for (const k of this.getAllKeys()) {
      rnLinux.storageRemove(this._ns + k);
    }
    this._notifyChanged('*');
  }

  // No-op. The JSON-file backend doesn't have an encryption layer to
  // re-key. Linux per-user file perms gate access to the data dir.
  recrypt(_key) {}

  // No-op. The JSON store doesn't have a separate free-list to
  // compact; size shrinks naturally as keys are removed.
  trim() {}

  toString() {
    return `MMKV (${this._id}): ${this.getAllKeys().length} keys`;
  }

  toJSON() {
    const obj = {};
    for (const k of this.getAllKeys()) {
      obj[k] = this.getString(k) ?? this.getNumber(k) ?? this.getBoolean(k);
    }
    return obj;
  }

  addOnValueChangedListener(onValueChanged) {
    if (typeof onValueChanged !== 'function') {
      throw new TypeError('addOnValueChangedListener: callback required');
    }
    let bucket = _listenersById.get(this._id);
    if (!bucket) {
      bucket = new Set();
      _listenersById.set(this._id, bucket);
    }
    bucket.add(onValueChanged);
    return {
      remove: () => {
        bucket.delete(onValueChanged);
      },
    };
  }

  _notifyChanged(key) {
    const bucket = _listenersById.get(this._id);
    if (!bucket) return;
    for (const fn of bucket) {
      try {
        fn(key);
      } catch (_) {}
    }
  }
}

// Module-level helpers expo apps sometimes import alongside the class.
function useMMKV(configuration) {
  // expo apps call this from React; we return a stable instance per
  // configuration.id since MMKV's docs say to do exactly that.
  const React = require('react');
  const id = (configuration && configuration.id) || 'mmkv.default';
  return React.useMemo(() => new MMKV(configuration), [id]);
}

const api = {
  MMKV,
  Mode,
  useMMKV,
};

module.exports = api;
module.exports.default = api;
