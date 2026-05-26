'use strict';

// Shim for `expo-document-picker`. Backed by GtkFileDialog via
// rnLinux.pickFiles (vnext/src/filepicker/*). Same backend
// powers expo-image-picker — the difference is the MIME filter.

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.pickFiles === 'function';

function _toAsset(file) {
  // Native side populates width/height via gdk_pixbuf_get_file_info
  // for image MIME types; everything else gets 0 (mapped to
  // undefined here so non-image consumers don't see bogus fields).
  const asset = {
    uri: 'file://' + file.path,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType || null,
  };
  if (typeof file.width === 'number' && file.width > 0) asset.width = file.width;
  if (typeof file.height === 'number' && file.height > 0) asset.height = file.height;
  return asset;
}

// expo-document-picker's options:
//   type: string | string[]   — MIME globs (e.g. ['application/pdf', 'text/*'])
//                                or "*/*" for any
//   multiple: bool
//   copyToCacheDirectory: bool  (defaults true upstream; we honor
//                                 by leaving the original path —
//                                 caller can copy via expo-file-system)
async function getDocumentAsync(options) {
  if (!_hasNative) {
    throw new Error('expo-document-picker: native rnLinux.pickFiles not bound');
  }
  const types = options?.type;
  const mimeFilters = !types || types === '*/*' ? [] : Array.isArray(types) ? types : [types];
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
        resolve({canceled: false, assets: result.assets.map(_toAsset)});
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
