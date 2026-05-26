'use strict';

// Shim for `expo-clipboard`. Backed by the existing
// rnLinux.clipboard* JSI bindings (vnext/src/jsi/RnLinuxBindings.cpp),
// which talk to GdkClipboard on the display.
//
// What's real vs not:
//   * text: set + get round-trip is real, including cross-app
//     pastes (the async path negotiates the MIME transfer with
//     whichever app put the text on the clipboard via
//     gdk_clipboard_read_text_async). The legacy synchronous
//     getter only sees this process's own writes — useful as a
//     fast in-process round-trip but doesn't see other apps.
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
  // Prefer the async path — it negotiates the MIME transfer with
  // whatever app put the text on the clipboard, so we see
  // cross-app pastes. The sync path only sees writes from our own
  // process and is kept as a synchronous fallback for old call sites.
  if (typeof rnLinux.clipboardGetStringAsync === 'function') {
    return new Promise((resolve, reject) => {
      rnLinux.clipboardGetStringAsync(
        text => resolve(typeof text === 'string' ? text : ''),
        msg => reject(new Error(msg)),
      );
    });
  }
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
  // without round-tripping the content. Read via the same async
  // path getStringAsync uses so cross-app text registers; a
  // false-negative on an empty-string copy is acceptable for the
  // upstream contract.
  const v = await getStringAsync();
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
// clipboard update from any source. We multiplex JS subscribers
// behind a single native trampoline so multiple consumers share
// one signal subscription, and tear the subscription down when
// the last listener unsubscribes.
const _changeSubs = new Set();
let _changeNativeWired = false;

function _ensureChangeWired() {
  if (_changeNativeWired) return;
  if (!_hasNative || typeof rnLinux.clipboardSetChangeListener !== 'function') return;
  rnLinux.clipboardSetChangeListener(payload => {
    for (const fn of _changeSubs) {
      try {
        fn(payload);
      } catch (_) {}
    }
  });
  _changeNativeWired = true;
}

function _teardownChangeIfIdle() {
  if (!_changeNativeWired || _changeSubs.size > 0) return;
  if (!_hasNative || typeof rnLinux.clipboardSetChangeListener !== 'function') return;
  rnLinux.clipboardSetChangeListener(null);
  _changeNativeWired = false;
}

function addClipboardListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('expo-clipboard: listener must be a function');
  }
  _changeSubs.add(listener);
  _ensureChangeWired();
  return {
    remove() {
      _changeSubs.delete(listener);
      _teardownChangeIfIdle();
    },
  };
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
