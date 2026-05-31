'use strict';

// Minimal jwt-decode shim. Real impl is itself ~30 lines and just
// base64url-decodes the middle segment of the JWT into a JSON payload.
// We do the same.

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(
    Array.prototype.map
      .call(globalThis.atob(s), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join(''),
  );
}

function jwtDecode(token, _options) {
  if (typeof token !== 'string') throw new TypeError('jwt-decode: token must be a string');
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('jwt-decode: token shape invalid');
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch (e) {
    throw new Error('jwt-decode: payload not JSON', {cause: e});
  }
}

function InvalidTokenError(msg) {
  this.message = msg;
  this.name = 'InvalidTokenError';
}
InvalidTokenError.prototype = Object.create(Error.prototype);

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.default = jwtDecode;
module.exports.jwtDecode = jwtDecode;
module.exports.InvalidTokenError = InvalidTokenError;
