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
      {},
      null,
      result => resolve(result),
      msg => reject(new Error(msg)),
    );
  });
}

// expo-file-system's DownloadResumable: pause/resume backed by HTTP
// Range. The savable() snapshot includes the bytes already on disk
// so a fresh DownloadResumable instance constructed from that
// snapshot can resume across process restarts.
class DownloadResumable {
  constructor(url, fileUri, options, callback, resumeData) {
    this._url = url;
    this._fileUri = fileUri;
    this._options = options || {};
    this._callback = typeof callback === 'function' ? callback : null;
    this._resumeData = resumeData || null;
    this._handle = null;
    this._cancelled = false;
  }

  async downloadAsync() {
    if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
    const dest = _toPath(this._fileUri);
    // resumeFromBytes priority: explicit resumeData > what's
    // already on disk at dest (so a fresh DownloadResumable can
    // re-attach to a previously-paused write without the caller
    // having to remember the byte count).
    let resumeFromBytes = 0;
    if (this._resumeData && typeof this._resumeData.bytesWritten === 'number') {
      resumeFromBytes = this._resumeData.bytesWritten;
    } else if (typeof rnLinux.fsGetInfo === 'function') {
      try {
        const info = rnLinux.fsGetInfo(dest, false);
        if (info && info.exists && !info.isDirectory) resumeFromBytes = info.size | 0;
      } catch (_) {}
    }
    this._cancelled = false;
    return new Promise((resolve, reject) => {
      this._handle = rnLinux.fsDownload(
        this._url,
        dest,
        {resumeFromBytes},
        this._callback
          ? (written, total) => {
              // expo's callback shape: {totalBytesWritten, totalBytesExpectedToWrite}
              this._callback({
                totalBytesWritten: written,
                totalBytesExpectedToWrite: total,
              });
            }
          : null,
        result => {
          this._handle = null;
          // Track progress so a subsequent resume picks up from
          // here. expo's contract: the resolved object is
          // {uri, status, headers, mimeType, ...}; mimeType / headers
          // aren't surfaced by our binding yet.
          this._resumeData = {bytesWritten: resumeFromBytes + result.size};
          resolve(result);
        },
        msg => {
          this._handle = null;
          if (this._cancelled && msg === 'cancelled') {
            // Snapshot the bytes already on disk for resume.
            try {
              const info = rnLinux.fsGetInfo(dest, false);
              if (info && info.exists) this._resumeData = {bytesWritten: info.size | 0};
            } catch (_) {}
            // Pause: resolve with undefined so callers can call
            // resumeAsync() / savable() afterwards. Mirrors the
            // upstream behavior.
            resolve(undefined);
            return;
          }
          reject(new Error(msg));
        },
      );
    });
  }

  async pauseAsync() {
    if (!this._handle) return this.savable();
    this._cancelled = true;
    rnLinux.fsDownloadCancel(this._handle);
    this._handle = null;
    return this.savable();
  }

  async resumeAsync() {
    return this.downloadAsync();
  }

  async cancelAsync() {
    if (this._handle) {
      this._cancelled = true;
      rnLinux.fsDownloadCancel(this._handle);
      this._handle = null;
    }
    // expo's contract: delete the partial file too.
    if (typeof rnLinux.fsDelete === 'function') {
      try {
        rnLinux.fsDelete(_toPath(this._fileUri), true);
      } catch (_) {}
    }
    this._resumeData = null;
  }

  savable() {
    return {
      url: this._url,
      fileUri: this._fileUri,
      options: this._options,
      resumeData: this._resumeData ? {...this._resumeData} : null,
    };
  }
}

function createDownloadResumable(url, fileUri, options, callback, resumeData) {
  return new DownloadResumable(url, fileUri, options, callback, resumeData);
}

// Upload — multipart and binary body variants. Method defaults
// match expo's defaults (POST for multipart, POST for binary).
// uploadType: FileSystemUploadType.MULTIPART | BINARY_CONTENT.
async function uploadAsync(url, fileUri, options) {
  if (!_hasNative) throw new Error('expo-file-system: native bindings not bound');
  if (typeof url !== 'string') throw new TypeError('uploadAsync: url must be a string');
  const filePath = _toPath(fileUri);
  const method = (options && options.httpMethod) || 'POST';
  const headers =
    options && options.headers && typeof options.headers === 'object'
      ? Object.entries(options.headers).map(([k, v]) => [String(k), String(v)])
      : [];
  const uploadType = options && options.uploadType;
  if (uploadType === FileSystemUploadType.MULTIPART) {
    const fieldName = (options && options.fieldName) || 'file';
    const mimeType = (options && options.mimeType) || 'application/octet-stream';
    const filename =
      (options && options.parameters && options.parameters._filename) ||
      filePath.split('/').pop() ||
      fieldName;
    const fields = [
      {name: fieldName, isFile: true, filePath, filename, mimeType},
      // expo's `parameters` map → multipart text fields. Strip the
      // _filename convention key (used above) before forwarding.
      ...Object.entries(options.parameters || {})
        .filter(([k]) => k !== '_filename')
        .map(([name, textValue]) => ({name, isFile: false, textValue: String(textValue)})),
    ];
    return new Promise((resolve, reject) => {
      rnLinux.fsUploadMultipart(
        url,
        method,
        fields,
        headers,
        result => resolve(result),
        msg => reject(new Error(msg)),
      );
    });
  }
  // BINARY_CONTENT (the default). Sends the file bytes as the
  // request body verbatim, with mimeType as content-type.
  const mimeType = (options && options.mimeType) || 'application/octet-stream';
  return new Promise((resolve, reject) => {
    rnLinux.fsUploadBinary(
      url,
      method,
      filePath,
      mimeType,
      headers,
      result => resolve(result),
      msg => reject(new Error(msg)),
    );
  });
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
