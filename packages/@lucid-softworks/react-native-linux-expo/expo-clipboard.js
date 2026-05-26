'use strict';

// Shim for `expo-clipboard`. Backed by the rnLinux.clipboard* JSI
// bindings (vnext/src/jsi/RnLinuxBindings.cpp), which talk to
// GdkClipboard on the display.
//
// API coverage:
//   * text: cross-app — get/setStringAsync, plus a sync get for the
//     fast in-process path.
//   * image: base64 PNG/JPEG round-trip through GdkTexture.
//   * html: unioned text/html + text/plain provider (the JS shim
//     extracts the plaintext fallback so terminals and search bars
//     still get something readable).
//   * files: setContentAsync({files: [...]}) publishes a GdkFileList
//     provider so file managers paste real file refs.
//   * change listener: GdkClipboard's `changed` signal fans out to
//     all JS subscribers, including cross-app writes.

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

// Image clipboard — base64 round-trip through GdkTexture. Native
// side decodes PNG/JPEG on set and re-encodes as PNG on get, so the
// JS contract matches expo's `data` (base64) + `size` (we don't
// surface size, callers can decode via a TypedArray if they need
// dimensions).
async function setImageAsync(base64Image) {
  if (!_hasNative || typeof rnLinux.clipboardSetImage !== 'function') return false;
  if (typeof base64Image !== 'string' || !base64Image) return false;
  // Strip a "data:image/...;base64," prefix if a caller pasted a
  // full data URL — the native decoder wants raw base64 bytes.
  const stripped = base64Image.includes(',') ? base64Image.split(',', 2)[1] : base64Image;
  return Boolean(rnLinux.clipboardSetImage(stripped));
}

async function getImageAsync(_options) {
  if (!_hasNative || typeof rnLinux.clipboardGetImageAsync !== 'function') return null;
  return new Promise((resolve, reject) => {
    rnLinux.clipboardGetImageAsync(
      (data, mime) => {
        if (!data) {
          resolve(null);
          return;
        }
        // expo's documented result shape is {data, size?}. We don't
        // ship size for now (would need a decode pass); callers who
        // need it can pipe through Image.getSize on the data URI.
        resolve({data, size: null, mime: mime || 'image/png'});
      },
      msg => reject(new Error(msg)),
    );
  });
}

async function hasImageAsync() {
  // GdkClipboard doesn't surface a "has image" predicate without
  // round-tripping content; we do the cheapest version of that
  // (probe + immediately discard) so this returns the right
  // boolean cross-app.
  const v = await getImageAsync();
  return v != null && typeof v.data === 'string' && v.data.length > 0;
}

// HTML clipboard — native side publishes a unioned text/html +
// text/plain provider so non-rich consumers (terminals, search bars)
// still see something readable. The plaintext fallback comes from
// stripping HTML in JS, since the native side doesn't carry an HTML
// parser.
function _htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getHtmlAsync() {
  if (!_hasNative || typeof rnLinux.clipboardGetHtmlAsync !== 'function') return '';
  return new Promise((resolve, reject) => {
    rnLinux.clipboardGetHtmlAsync(
      html => resolve(typeof html === 'string' ? html : ''),
      msg => reject(new Error(msg)),
    );
  });
}

async function setHtmlAsync(html) {
  if (!_hasNative || typeof rnLinux.clipboardSetHtml !== 'function') return false;
  const safe = String(html ?? '');
  return Boolean(rnLinux.clipboardSetHtml(safe, _htmlToText(safe)));
}

async function hasHtmlAsync() {
  const v = await getHtmlAsync();
  return typeof v === 'string' && v.length > 0;
}

// File list — expo's setContentAsync({files: [...]}) lands here.
// Accepts an array of absolute paths or file:// URIs and publishes
// a GdkFileList content provider so paste in a file manager creates
// real file refs (not just text).
async function setContentAsync(content) {
  if (!content || typeof content !== 'object') return false;
  if (Array.isArray(content.files) && content.files.length > 0) {
    if (!_hasNative || typeof rnLinux.clipboardSetFiles !== 'function') return false;
    return Boolean(rnLinux.clipboardSetFiles(content.files.map(String)));
  }
  if (typeof content.text === 'string') return setStringAsync(content.text);
  if (typeof content.html === 'string') return setHtmlAsync(content.html);
  if (typeof content.image === 'string') return setImageAsync(content.image);
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
  // Combined setter (files / text / html / image)
  setContentAsync,
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
