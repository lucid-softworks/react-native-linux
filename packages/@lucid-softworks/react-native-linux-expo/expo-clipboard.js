'use strict';

// Shim for `expo-clipboard`. Backed by the existing
// rnLinux.clipboard* JSI bindings (vnext/src/jsi/RnLinuxBindings.cpp),
// which talk to GdkClipboard on the display.
//
// What's real vs not:
//   * text: set + get round-trip is real, including cross-app
//     pastes for sets we wrote. Reads of the same-process clipboard
//     are sync via gdk_clipboard_get_content; reads of OTHER apps'
//     selections need the async read_text path that's not bound
//     yet (the sync fallback returns "" for those).
//   * images / HTML / files: GdkClipboard supports them natively
//     but the upstream API shapes (base64 PNG, HTML+plaintext
//     fallback, file list) need more plumbing. Stubbed to throw
//     with a clear message so consumers fail loudly rather than
//     silently get empty results.
//   * change listener: subscribes to GdkClipboard's `changed`
//     signal, but that's not bound JSI-side yet — addListener
//     returns a no-op subscription for now.

const _hasNative =
  typeof rnLinux !== 'undefined' && typeof rnLinux.clipboardSetString === 'function';

async function getStringAsync(_options) {
  if (!_hasNative) return '';
  return String(rnLinux.clipboardGetStringSync());
}

async function setStringAsync(text, _options) {
  if (!_hasNative) return false;
  rnLinux.clipboardSetString(String(text ?? ''));
  return true;
}

// setString (no Async suffix) — older expo-clipboard name. Same path.
function setString(text) {
  if (!_hasNative) return;
  rnLinux.clipboardSetString(String(text ?? ''));
}

async function hasStringAsync() {
  if (!_hasNative) return false;
  // GdkClipboard doesn't surface a clean "has text" predicate
  // without round-tripping the content. Reading + checking length
  // is the cheapest approximation; a falser-than-correct result on
  // an empty-string copy is acceptable for the upstream contract.
  const v = rnLinux.clipboardGetStringSync();
  return typeof v === 'string' && v.length > 0;
}

// Images, HTML, URLs, file lists — GdkClipboard supports them but
// the API shape needs more wiring (base64 PNG round-trip, HTML+plain
// fallback). Throw with a clear message rather than lie about
// success or return empty strings that consumers might trust.
async function getImageAsync(_options) {
  throw new Error('expo-clipboard: getImageAsync not implemented on Linux yet');
}
async function setImageAsync(_base64Image) {
  throw new Error('expo-clipboard: setImageAsync not implemented on Linux yet');
}
async function hasImageAsync() {
  return false;
}

async function getHtmlAsync() {
  throw new Error('expo-clipboard: getHtmlAsync not implemented on Linux yet');
}
async function setHtmlAsync(_html) {
  throw new Error('expo-clipboard: setHtmlAsync not implemented on Linux yet');
}
async function hasHtmlAsync() {
  return false;
}

async function getUrlAsync() {
  // Expo's "URL" type maps to NSURL on iOS — there's no Linux clip
  // type for URLs distinct from plain text. Fall through to the
  // text path so a plain URL on the clipboard is still returned.
  return getStringAsync();
}
async function setUrlAsync(url) {
  return setStringAsync(url);
}
async function hasUrlAsync() {
  return hasStringAsync();
}

// Change listener — GdkClipboard fires a `changed` signal on every
// clipboard update from any source. The JSI binding for the
// subscription isn't wired yet; return a no-op subscription so apps
// that always register on mount don't crash.
function addClipboardListener(_listener) {
  return {remove() {}};
}
function removeClipboardListener(sub) {
  if (sub && typeof sub.remove === 'function') sub.remove();
}

const ContentType = {
  PLAIN_TEXT: 'plain-text',
  HTML: 'html',
  IMAGE: 'image',
  URL: 'url',
};

const StringFormat = {
  PLAIN_TEXT: 'plainText',
  HTML: 'html',
};

const ImageFormat = {
  PNG: 'png',
  JPEG: 'jpeg',
};

const api = {
  // Text
  getStringAsync,
  setStringAsync,
  setString,
  hasStringAsync,
  // Image
  getImageAsync,
  setImageAsync,
  hasImageAsync,
  // HTML
  getHtmlAsync,
  setHtmlAsync,
  hasHtmlAsync,
  // URL
  getUrlAsync,
  setUrlAsync,
  hasUrlAsync,
  // Listener
  addClipboardListener,
  removeClipboardListener,
  // Enums
  ContentType,
  StringFormat,
  ImageFormat,
};

module.exports = api;
module.exports.default = api;
