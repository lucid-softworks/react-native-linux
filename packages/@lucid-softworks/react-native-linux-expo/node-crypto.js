'use strict';

// Node-style `crypto` module shim. Real apps reach for this either
// directly (`const crypto = require('crypto'); crypto.randomBytes(16)`)
// or transitively through libraries (uuid, jsonwebtoken, etc.).
//
// We expose the small Web-Crypto-compatible surface that React Native
// apps actually use:
//
//   crypto.randomBytes(size) → Buffer-like Uint8Array
//   crypto.randomUUID()      → UUID v4 string
//   crypto.getRandomValues(typedArray) → fills + returns the array
//
// Entropy comes from `rnLinux.cryptoRandomBytes(n)` which is backed
// by getrandom(2) on the C++ side — the right CSPRNG for any keying
// or token use.
//
// What's deliberately NOT here: ciphers, hashes via createHash (use
// `expo-crypto` if you need a digest), HMAC. None of the smoke
// targets touch those, and a real `crypto.createHash` would need a
// matching streaming impl backed by GChecksum.

const RANDOM_CHUNK = 1024 * 1024; // matches the C++ binding's cap

function base64ToBytes(b64) {
  // atob is shimmed in our runtime — Hermes ships it as of 0.12.
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(size) {
  if (typeof size !== 'number' || size < 0 || !Number.isFinite(size)) {
    throw new RangeError('randomBytes: size must be a non-negative finite number');
  }
  // The C++ binding caps each call at 1 MiB; for the (very rare) larger
  // requests, stitch multiple chunks together.
  if (size === 0) return new Uint8Array(0);
  const chunks = [];
  let remaining = size;
  while (remaining > 0) {
    const take = Math.min(RANDOM_CHUNK, remaining);
    chunks.push(base64ToBytes(rnLinux.cryptoRandomBytes(take)));
    remaining -= take;
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function getRandomValues(typedArray) {
  if (!ArrayBuffer.isView(typedArray)) {
    throw new TypeError('getRandomValues: argument must be a typed array');
  }
  // Spec: byte length is what gets randomized regardless of element size.
  const bytes = randomBytes(typedArray.byteLength);
  new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength).set(bytes);
  return typedArray;
}

function randomUUID() {
  // UUID v4. Set the version + variant bits per RFC 4122.
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [];
  for (let i = 0; i < 16; i++) {
    hex.push((b[i] < 16 ? '0' : '') + b[i].toString(16));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.randomBytes = randomBytes;
module.exports.getRandomValues = getRandomValues;
module.exports.randomUUID = randomUUID;
// `import crypto from 'crypto'` reads the default slot; we point it
// at the namespace itself so both default and named access work.
module.exports.default = {randomBytes, getRandomValues, randomUUID};
