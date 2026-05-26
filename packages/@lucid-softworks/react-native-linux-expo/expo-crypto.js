'use strict';

// Shim for `expo-crypto`. CSPRNG random bytes + SHA digests + RFC4122
// v4 UUID via the rnLinux.crypto* JSI bindings.
//
// The native side returns base64-encoded bytes / hex strings; this
// shim decodes back into the Uint8Array / ArrayBuffer shapes expo's
// API documents. Critical for atproto / DPoP signing — @noble's
// signing path calls getRandomValues on every sign.

const _hasNative =
  typeof rnLinux !== 'undefined' && typeof rnLinux.cryptoRandomBytes === 'function';

const CryptoDigestAlgorithm = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA384: 'SHA-384',
  SHA512: 'SHA-512',
  // MD2 / MD4 are iOS-only in upstream; not exposed here. MD5 is
  // supported by the native binding but unsafe for crypto — only
  // useful for content-addressable lookups (matches upstream's note).
  MD5: 'MD5',
};

const CryptoEncoding = {
  HEX: 'hex',
  BASE64: 'base64',
};

function _b64ToUint8(b64) {
  // atob returns a binary string; copy each char's code point into a
  // typed array. Hermes ships globalThis.atob in modern builds.
  if (typeof globalThis.atob !== 'function') {
    throw new Error('expo-crypto: atob unavailable; cannot decode native base64');
  }
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; ++i) out[i] = bin.charCodeAt(i);
  return out;
}

function _uint8ToB64(arr) {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('expo-crypto: btoa unavailable; cannot encode for native digest');
  }
  let bin = '';
  // String.fromCharCode in chunks — large arrays would overflow the
  // arg list otherwise.
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      arr.subarray ? arr.subarray(i, i + chunk) : Array.from(arr.slice(i, i + chunk)),
    );
  }
  return globalThis.btoa(bin);
}

function _hexToUint8(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; ++i) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function getRandomBytes(byteCount) {
  if (!_hasNative) throw new Error('expo-crypto: native bindings not bound');
  const b64 = rnLinux.cryptoRandomBytes(byteCount | 0);
  return _b64ToUint8(b64);
}

async function getRandomBytesAsync(byteCount) {
  return getRandomBytes(byteCount);
}

function getRandomValues(typedArray) {
  if (!typedArray || typeof typedArray.byteLength !== 'number') {
    throw new TypeError('getRandomValues: expected a typed array');
  }
  if (typedArray.byteLength > 65536) {
    throw new RangeError('getRandomValues: max byteLength is 65536');
  }
  const bytes = getRandomBytes(typedArray.byteLength);
  // Copy through a Uint8Array view to handle any typed-array width
  // (Int8/Uint16/Int32/etc.) — the spec says the underlying buffer
  // is filled with random bytes regardless of element type.
  new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength).set(bytes);
  return typedArray;
}

function randomUUID() {
  if (!_hasNative) throw new Error('expo-crypto: native bindings not bound');
  return rnLinux.cryptoUUID();
}

async function digest(algorithm, data) {
  if (!_hasNative) throw new Error('expo-crypto: native bindings not bound');
  // `data` may be a string, ArrayBuffer, or typed array (BufferSource).
  // Normalize to a Uint8Array → base64 string for the native call.
  let bytes;
  if (typeof data === 'string') {
    // expo's `digest` doesn't accept strings (that's `digestStringAsync`);
    // but if it lands here, treat as UTF-8.
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    throw new TypeError('digest: data must be a string, ArrayBuffer, or typed array');
  }
  const hex = rnLinux.cryptoDigest(algorithm, _uint8ToB64(bytes));
  return _hexToUint8(hex).buffer;
}

async function digestStringAsync(algorithm, data, options) {
  if (!_hasNative) throw new Error('expo-crypto: native bindings not bound');
  const encoding = (options && options.encoding) || CryptoEncoding.HEX;
  const bytes = new TextEncoder().encode(String(data));
  const hex = rnLinux.cryptoDigest(algorithm, _uint8ToB64(bytes));
  if (encoding === CryptoEncoding.BASE64) {
    return _uint8ToB64(_hexToUint8(hex));
  }
  return hex;
}

const api = {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  getRandomBytes,
  getRandomBytesAsync,
  getRandomValues,
  randomUUID,
  digest,
  digestStringAsync,
};

module.exports = api;
module.exports.default = api;
