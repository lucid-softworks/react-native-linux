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

// Fetch the content at a uri and return its raw text. Supports
// file:// (read directly), http(s):// (download to a temp path
// then read), and data: URIs (decode inline). Pulls from native
// bindings rather than `require('expo-file-system')` because
// this shim is bundled into vendor.bundle, which bypasses metro
// alias resolution and would otherwise load the upstream npm
// package and crash on requireNativeModule.
async function _fetchUriToText(uri) {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    if (comma < 0) return '';
    const header = uri.slice(5, comma);
    const body = uri.slice(comma + 1);
    if (header.includes(';base64')) {
      try {
        return globalThis.atob(body);
      } catch (_) {
        return body;
      }
    }
    try {
      return decodeURIComponent(body);
    } catch (_) {
      return body;
    }
  }
  if (uri.startsWith('file://')) {
    const path = uri.slice('file://'.length);
    if (typeof rnLinux.fsReadString === 'function') {
      return String(rnLinux.fsReadString(path, 'utf8'));
    }
    throw new Error('expo-print: fsReadString binding missing');
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    if (typeof rnLinux.fsDownload !== 'function' || typeof rnLinux.fsReadString !== 'function') {
      throw new Error('expo-print: HTTP uri fetch needs fsDownload + fsReadString bindings');
    }
    // Download to a temp path inside cacheDirectory, read back,
    // then unlink. Synchronous read is fine — we just dropped the
    // bytes there ourselves so the page cache is warm.
    let dir = '/tmp/';
    if (typeof rnLinux.fsConstants === 'function') {
      const c = rnLinux.fsConstants();
      if (c && c.cacheDirectory) dir = c.cacheDirectory.replace('file://', '');
    }
    const dest = `${dir}print-fetch-${Date.now()}.html`;
    await new Promise((resolve, reject) => {
      rnLinux.fsDownload(
        uri,
        dest,
        () => resolve(),
        msg => reject(new Error(msg)),
      );
    });
    try {
      return String(rnLinux.fsReadString(dest, 'utf8'));
    } finally {
      if (typeof rnLinux.fsDelete === 'function') {
        try {
          rnLinux.fsDelete(dest, true);
        } catch (_) {}
      }
    }
  }
  throw new Error(`expo-print: unsupported uri scheme — ${uri.slice(0, 16)}…`);
}

async function _payloadText(options) {
  if (typeof options?.html === 'string') return _htmlToText(options.html);
  if (typeof options?.uri === 'string') {
    const raw = await _fetchUriToText(options.uri);
    // Most {uri} payloads are HTML; if the content looks like raw
    // text already (no angle brackets at all), pass through.
    return /<[^>]+>/.test(raw) ? _htmlToText(raw) : raw;
  }
  return '';
}

async function printAsync(options) {
  if (!_hasNative) {
    throw new Error('expo-print: native rnLinux.printText not bound');
  }
  const text = await _payloadText(options);
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
  const text = await _payloadText(options);
  // expo-print returns a Promise<{uri, numberOfPages, base64?}>.
  // We don't compute base64 (would mean reading the file back +
  // encoding — cheap, but adds latency); the caller can read it
  // via expo-file-system if needed. numberOfPages is reported by
  // the native side from Pango's pagination result.
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
      (uri, numberOfPages) =>
        resolve({
          uri,
          numberOfPages: typeof numberOfPages === 'number' && numberOfPages > 0 ? numberOfPages : 1,
          base64: undefined,
        }),
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
