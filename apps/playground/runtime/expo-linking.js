'use strict';

// Shim for `expo-linking`. The real module is a superset of RN's
// Linking with URL parsing helpers and deep-link routing. We re-export
// RN's Linking and add the parse helpers expo-router needs.

const {Linking} = require('./react-native');

function parse(url) {
  // Hand-rolled because Hermes doesn't ship the URL constructor and
  // the WHATWG parser is overkill for what we need.
  const out = {scheme: null, hostname: null, path: null, queryParams: {}};
  if (typeof url !== 'string') return out;
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
  if (!schemeMatch) return out;
  out.scheme = schemeMatch[1];
  let rest = schemeMatch[2];
  const qIdx = rest.indexOf('?');
  let query = '';
  if (qIdx >= 0) {
    query = rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
  }
  const slashIdx = rest.indexOf('/');
  if (slashIdx >= 0) {
    out.hostname = rest.slice(0, slashIdx);
    out.path = rest.slice(slashIdx);
  } else {
    out.hostname = rest;
    out.path = '';
  }
  if (query) {
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=');
      const k = eq >= 0 ? pair.slice(0, eq) : pair;
      const v = eq >= 0 ? pair.slice(eq + 1) : '';
      try {
        out.queryParams[decodeURIComponent(k)] = decodeURIComponent(v);
      } catch {
        out.queryParams[k] = v;
      }
    }
  }
  return out;
}

function createURL(path, options = {}) {
  const scheme = options.scheme ?? 'rnl';
  return `${scheme}://${path.replace(/^\//, '')}`;
}

function useURL() {
  // Real hook listens for incoming deep links; on desktop without
  // OS-level URL handling we just report null. Apps using this for
  // initial routing should gracefully fall through to their default.
  return null;
}

module.exports = {
  ...Linking,
  parse,
  createURL,
  useURL,
  // Reverse compat name used by some packages.
  parseInitialURLAsync: () => Promise.resolve({scheme: null, path: null, queryParams: {}}),
  getInitialURL: () => Promise.resolve(null),
  addEventListener: (...args) => Linking.addEventListener(...args),
};
