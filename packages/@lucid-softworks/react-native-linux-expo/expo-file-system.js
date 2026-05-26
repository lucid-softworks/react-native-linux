'use strict';

// Shim for `expo-file-system`. Backed by direct POSIX syscalls in
// vnext/src/filesystem/FileSystem.cpp; downloads go through libsoup.
//
// URI handling: upstream's API accepts `file://...` URIs everywhere.
// Our native side wants plain paths, so this shim strips the scheme
// at every boundary. Directory constants (`documentDirectory`,
// `cacheDirectory`, `bundleDirectory`) ARE returned as `file://`
// URIs so callers can string-concat them the same way they do on
// iOS/Android.

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.fsReadString === 'function';

const _constants = _hasNative
  ? rnLinux.fsConstants()
  : {documentDirectory: '', cacheDirectory: '', bundleDirectory: ''};

const EncodingType = {
  UTF8: 'utf8',
  Base64: 'base64',
};

const FileSystemSessionType = {
  BACKGROUND: 0,
  FOREGROUND: 1,
};

const FileSystemUploadType = {
  BINARY_CONTENT: 0,
  MULTIPART: 1,
};

// Strip the `file://` scheme; expo apps pass URIs OR paths so we
// accept both. Everything in C++ deals in plain paths.
function _toPath(uri) {
  if (typeof uri !== 'string') {
    throw new TypeError('expo-file-system: uri must be a string');
  }
  if (uri.startsWith('file://')) return uri.slice('file://'.length);
  return uri;
}

async function readAsStringAsync(fileUri, options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  const encoding = options?.encoding ?? EncodingType.UTF8;
  return rnLinux.fsReadString(_toPath(fileUri), encoding);
}

async function writeAsStringAsync(fileUri, contents, options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  const encoding = options?.encoding ?? EncodingType.UTF8;
  rnLinux.fsWriteString(_toPath(fileUri), String(contents ?? ''), encoding);
}

async function deleteAsync(fileUri, options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  const idempotent = options?.idempotent === true;
  rnLinux.fsDelete(_toPath(fileUri), idempotent);
}

async function getInfoAsync(fileUri, options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  const wantMd5 = options?.md5 === true;
  return rnLinux.fsGetInfo(_toPath(fileUri), wantMd5);
}

async function makeDirectoryAsync(fileUri, options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  const intermediates = options?.intermediates === true;
  rnLinux.fsMakeDirectory(_toPath(fileUri), intermediates);
}

async function readDirectoryAsync(fileUri) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  return rnLinux.fsReadDirectory(_toPath(fileUri));
}

async function copyAsync(options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  if (!options?.from || !options?.to) {
    throw new TypeError('copyAsync requires {from, to}');
  }
  rnLinux.fsCopy(_toPath(options.from), _toPath(options.to));
}

async function moveAsync(options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  if (!options?.from || !options?.to) {
    throw new TypeError('moveAsync requires {from, to}');
  }
  rnLinux.fsMove(_toPath(options.from), _toPath(options.to));
}

async function downloadAsync(url, fileUri, _options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  if (typeof url !== 'string') throw new TypeError('downloadAsync: url must be a string');
  const dest = _toPath(fileUri);
  return new Promise((resolve, reject) => {
    rnLinux.fsDownload(
      url,
      dest,
      result => resolve(result),
      msg => reject(new Error(msg)),
    );
  });
}

// expo-file-system also exposes a DownloadResumable / UploadTask
// pair backed by Android-only NSURLSession-style resumable IO.
// Implementing those needs HTTP Range support in libsoup (it has
// it) plus durable state (the savable resume token). Out of scope
// for the first cut; we expose the class shape so type imports
// don't crash, and `resumeAsync` falls through to a full download.
class DownloadResumable {
  constructor(url, fileUri, options) {
    this._url = url;
    this._fileUri = fileUri;
    this._options = options;
  }
  async downloadAsync() {
    return downloadAsync(this._url, this._fileUri, this._options);
  }
  async pauseAsync() {
    throw new Error('expo-file-system: DownloadResumable.pauseAsync not implemented on Linux');
  }
  async resumeAsync() {
    return downloadAsync(this._url, this._fileUri, this._options);
  }
  async cancelAsync() {
    throw new Error('expo-file-system: DownloadResumable.cancelAsync not implemented on Linux');
  }
  savable() {
    return {url: this._url, fileUri: this._fileUri, options: this._options};
  }
}

function createDownloadResumable(url, fileUri, options, _callback, _resumeData) {
  return new DownloadResumable(url, fileUri, options);
}

// Upload (multipart / binary) — same story as resumable downloads.
// Expose the function so consumers don't fail at import time, throw
// from the actual call.
async function uploadAsync(_url, _fileUri, _options) {
  throw new Error('expo-file-system: uploadAsync not implemented on Linux');
}

// SAF (Storage Access Framework) — Android-only. Map the most
// common ops onto our regular file ops so cross-platform code that
// reaches for SAF on Linux still works for the simple cases.
const StorageAccessFramework = {
  async requestDirectoryPermissionsAsync() {
    return {granted: false, directoryUri: ''};
  },
  async readDirectoryAsync(uri) {
    return readDirectoryAsync(uri);
  },
  async makeDirectoryAsync(parentUri, dirName) {
    const dest = _toPath(parentUri).replace(/\/?$/, '/') + dirName;
    rnLinux.fsMakeDirectory(dest, true);
    return 'file://' + dest;
  },
  async createFileAsync(parentUri, fileName, _mimeType) {
    const dest = _toPath(parentUri).replace(/\/?$/, '/') + fileName;
    rnLinux.fsWriteString(dest, '', EncodingType.UTF8);
    return 'file://' + dest;
  },
  async writeAsStringAsync(uri, contents, options) {
    return writeAsStringAsync(uri, contents, options);
  },
  async readAsStringAsync(uri, options) {
    return readAsStringAsync(uri, options);
  },
  async deleteAsync(uri, options) {
    return deleteAsync(uri, options);
  },
  async copyAsync(opts) {
    return copyAsync(opts);
  },
  async moveAsync(opts) {
    return moveAsync(opts);
  },
};

// Disk-space helpers — backed by statvfs(3) on the filesystem that
// holds documentDirectory (where expo apps actually write). Strip
// the trailing slash so statvfs sees a real path, not "<dir>/".
function _docDirPath() {
  const d = _constants.documentDirectory || '/';
  const stripped = d.startsWith('file://') ? d.slice('file://'.length) : d;
  return stripped.length > 1 && stripped.endsWith('/') ? stripped.slice(0, -1) : stripped;
}
async function getFreeDiskStorageAsync() {
  if (!_hasNative || typeof rnLinux.fsFreeDiskBytes !== 'function') return -1;
  return Number(rnLinux.fsFreeDiskBytes(_docDirPath()));
}
async function getTotalDiskCapacityAsync() {
  if (!_hasNative || typeof rnLinux.fsTotalDiskBytes !== 'function') return -1;
  return Number(rnLinux.fsTotalDiskBytes(_docDirPath()));
}

// Content URI helpers — Android-only on real expo. Throw rather than
// returning a fake "content:" URI that downstream code might try to
// open via an Android-only intent.
async function getContentUriAsync(_fileUri) {
  throw new Error('expo-file-system: getContentUriAsync is Android-only');
}

const api = {
  // Constants
  documentDirectory: _constants.documentDirectory,
  cacheDirectory: _constants.cacheDirectory,
  bundleDirectory: _constants.bundleDirectory,
  // Enums
  EncodingType,
  FileSystemSessionType,
  FileSystemUploadType,
  // File ops
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  getInfoAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
  copyAsync,
  moveAsync,
  downloadAsync,
  uploadAsync,
  createDownloadResumable,
  DownloadResumable,
  StorageAccessFramework,
  // Disk
  getFreeDiskStorageAsync,
  getTotalDiskCapacityAsync,
  getContentUriAsync,
};

module.exports = api;
module.exports.default = api;
