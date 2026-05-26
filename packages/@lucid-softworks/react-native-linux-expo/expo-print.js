'use strict';

// Shim for `expo-print`. GtkPrintOperation handles the dialog +
// spooler integration; cairo PDF surface handles printToFile.
// Both render through Pango — HTML input is stripped to
// plaintext here (full HTML rendering would mean WebKitGTK,
// which we're not pulling in; see docs/realworld-expo-print.md).

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.printText === 'function';

// Very small HTML → plaintext converter. expo-print's most common
// `html` payload is a paragraph or two of text wrapped in basic
// tags (no JS, no CSS, no images). This is good enough to print
// the content; layout fidelity is the gap.
function _htmlToText(html) {
  if (!html) return '';
  return (
    String(html)
      // Block-level breaks become newlines so paragraphs stay separated.
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, '\n')
      // Strip all remaining tags.
      .replace(/<[^>]+>/g, '')
      // Decode the common entities expo-print users hit.
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      // Collapse runs of whitespace inside lines (preserve newlines).
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// expo-print's `Print.OrientationType` enum — accepted, ignored
// (the print dialog lets the user pick orientation).
const Orientation = {
  portrait: 'portrait',
  landscape: 'landscape',
};

function _payloadText(options) {
  if (typeof options?.html === 'string') return _htmlToText(options.html);
  if (typeof options?.uri === 'string') {
    // We can't fetch a URI to print synchronously without pulling
    // in libsoup here; throw with a clear message rather than
    // print an empty page.
    throw new Error(
      'expo-print: printing from {uri} is not implemented on Linux yet — pass {html} instead',
    );
  }
  return '';
}

async function printAsync(options) {
  if (!_hasNative) {
    throw new Error('expo-print: native rnLinux.printText not bound');
  }
  const text = _payloadText(options);
  return new Promise((resolve, reject) => {
    rnLinux.printText(
      text,
      () => resolve(),
      msg => reject(new Error(msg)),
    );
  });
}

async function printToFileAsync(options) {
  if (!_hasNative) {
    throw new Error('expo-print: native rnLinux.printExportPdf not bound');
  }
  const text = _payloadText(options);
  // expo-print returns a Promise<{uri, numberOfPages, base64?}>.
  // We don't compute base64 (would mean reading the file back +
  // encoding — cheap, but adds latency); the caller can read it
  // via expo-file-system if needed.
  //
  // For the output path, we reach for rnLinux.fsConstants
  // directly rather than `require('expo-file-system')` — when
  // this shim file is bundled into vendor.bundle by esbuild,
  // require() bypasses our metro alias and tries to resolve the
  // upstream npm package, which throws on its requireNativeModule
  // call. The native binding gives us the same data without that
  // detour.
  let dir = '/tmp/';
  if (typeof rnLinux !== 'undefined' && typeof rnLinux.fsConstants === 'function') {
    const c = rnLinux.fsConstants();
    if (c && c.cacheDirectory) {
      dir = c.cacheDirectory.replace('file://', '');
    }
  }
  const path = `${dir}print-${Date.now()}.pdf`;
  return new Promise((resolve, reject) => {
    rnLinux.printExportPdf(
      text,
      path,
      uri => resolve({uri, numberOfPages: null, base64: undefined}),
      msg => reject(new Error(msg)),
    );
  });
}

// expo-print's iOS-only printer-picker call. Unsupported on
// Linux — the system print dialog handles printer selection
// inline.
async function selectPrinterAsync() {
  throw new Error('expo-print: selectPrinterAsync is iOS-only');
}

const api = {
  Orientation,
  printAsync,
  printToFileAsync,
  selectPrinterAsync,
};

module.exports = api;
module.exports.default = api;
