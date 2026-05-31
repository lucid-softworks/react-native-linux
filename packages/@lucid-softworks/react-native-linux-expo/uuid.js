'use strict';

// `uuid` shim. The real package's ESM build doesn't export a default,
// so `import uuid from 'uuid'` esbuild-fails in strict mode. The
// shim exposes BOTH `default` and the named v1/v4/v5/etc. exports
// so either import shape resolves. Random bytes come from
// rnLinux.cryptoRandomBytes via the node-crypto shim — same CSPRNG.

const {randomBytes} = require('./node-crypto');

function v4() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [];
  for (let i = 0; i < 16; i++) hex.push((b[i] < 16 ? '0' : '') + b[i].toString(16));
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

// v1 (timestamp-based) — RN apps rarely need the timestamp property
// guarantees; a v4 is a workable stand-in for smoke purposes.
function v1() {
  return v4();
}
// v3 / v5 (namespace-based) — same fallback. Real impls require
// crypto hashes of (namespace + name); we don't implement.
function v3() {
  return v4();
}
function v5() {
  return v4();
}
function v7() {
  return v4();
}
function NIL() {
  return '00000000-0000-0000-0000-000000000000';
}

function validate(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}

function version(s) {
  return validate(s) ? parseInt(s[14], 16) : null;
}

function parse(s) {
  // Returns a 16-byte array view of the uuid.
  if (!validate(s)) throw new TypeError('Invalid UUID');
  const hex = s.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function stringify(arr) {
  const hex = [];
  for (let i = 0; i < 16; i++) hex.push((arr[i] < 16 ? '0' : '') + arr[i].toString(16));
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
// `import uuid from 'uuid'` — the form with-firebase-storage-upload
// uses. Real uuid doesn't ship a default, so the shim does.
module.exports.default = v4;
module.exports.v1 = v1;
module.exports.v3 = v3;
module.exports.v4 = v4;
module.exports.v5 = v5;
module.exports.v7 = v7;
module.exports.NIL = NIL();
module.exports.validate = validate;
module.exports.version = version;
module.exports.parse = parse;
module.exports.stringify = stringify;
