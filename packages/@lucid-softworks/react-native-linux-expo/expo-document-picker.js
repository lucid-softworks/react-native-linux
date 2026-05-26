'use strict';

// Shim for `expo-document-picker`. Backed by GtkFileDialog via
// rnLinux.pickFiles (vnext/src/filepicker/*). Same backend
// powers expo-image-picker — the difference is the MIME filter.

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.pickFiles === 'function';

// Copy a picked file into the app's cache dir so the original
// can't be modified or unlinked out from under the consumer. Used
// when expo's `copyToCacheDirectory` is not explicitly disabled
// (it defaults to true). Returns the cache-relative path.
function _copyToCache(srcPath, filename) {
  const c = rnLinux.fsConstants();
  const cacheDir = (c && c.cacheDirectory ? c.cacheDirectory : 'file:///tmp/').replace(
    'file://',
    '',
  );
  const subdir = `${cacheDir}DocumentPicker/`;
  rnLinux.fsMakeDirectory(subdir, true);
  // Prefix with a timestamp + random suffix so concurrent picks
  // of the same filename don't collide.
  const safe = (filename || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const dest = `${subdir}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  rnLinux.fsCopy(srcPath, dest);
  return dest;
}

function _toAsset(file, copyToCache) {
  // Optionally copy the file into cache so we hand the consumer a
  // path it owns. Falls back to the original on copy failure so a
  // permission glitch on the source doesn't break the picker.
  let path = file.path;
  if (copyToCache) {
    try {
      path = _copyToCache(file.path, file.name);
    } catch (_) {}
  }
  const asset = {
    uri: 'file://' + path,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType || null,
  };
  if (typeof file.width === 'number' && file.width > 0) asset.width = file.width;
  if (typeof file.height === 'number' && file.height > 0) asset.height = file.height;
  if (typeof file.durationMs === 'number' && file.durationMs > 0) {
    // expo's contract uses seconds (float) for video duration.
    asset.duration = file.durationMs / 1000;
  }
  return asset;
}

// expo-document-picker options:
//   type: string | string[]   — MIME globs (e.g. ['application/pdf', 'text/*'])
//                                or "*/*" for any
//   multiple: bool
//   copyToCacheDirectory: bool  (defaults true upstream)
async function getDocumentAsync(options) {
  if (!_hasNative) {
    throw new Error('expo-document-picker: native rnLinux.pickFiles not bound');
  }
  const types = options?.type;
  const mimeFilters = !types || types === '*/*' ? [] : Array.isArray(types) ? types : [types];
  // Default-true: only opt out when caller explicitly sets false.
  const copyToCache = options?.copyToCacheDirectory !== false;
  return new Promise((resolve, reject) => {
    rnLinux.pickFiles(
      {
        title: 'Choose a file',
        mimeFilters,
        multiple: options?.multiple === true,
      },
      result => {
        if (result.canceled) {
          resolve({canceled: true, assets: null, output: null});
          return;
        }
        resolve({canceled: false, assets: result.assets.map(f => _toAsset(f, copyToCache))});
      },
      msg => reject(new Error(msg)),
    );
  });
}

const api = {
  getDocumentAsync,
};

module.exports = api;
module.exports.default = api;
