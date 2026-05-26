'use strict';

// Shim for `expo-image-picker`. launchImageLibraryAsync goes
// through the shared GtkFileDialog backend (rnLinux.pickFiles)
// with image/* MIME filters. launchCameraAsync chains into the
// existing rnLinux.cameraSnap binding (one-shot pngenc pipeline
// from the expo-camera work). Permissions return granted on
// Linux — no per-app library/camera gate exists at the freedesktop
// layer.

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.pickFiles === 'function';

const _hasCamera = typeof rnLinux !== 'undefined' && typeof rnLinux.cameraSnap === 'function';

// MediaTypeOptions — upstream's legacy enum (still in v15+ for
// back-compat). String form is what newer code expects;
// MediaType array form is the v15+ shape.
const MediaTypeOptions = {
  All: 'All',
  Videos: 'Videos',
  Images: 'Images',
};

const MediaType = {
  Images: 'images',
  Videos: 'videos',
  Livephotos: 'livephotos',
};

const CameraType = {front: 'front', back: 'back'};
const ImagePickerOrderBy = {Default: 'default', Newest: 'newest', Oldest: 'oldest'};
const VideoExportPreset = {Passthrough: 0, LowQuality: 1, MediumQuality: 2, HighestQuality: 3};
const UIImagePickerControllerQualityType = {
  High: 0,
  Medium: 1,
  Low: 2,
  VGA640x480: 3,
  IFrame1280x720: 4,
  IFrame960x540: 5,
};
const UIImagePickerPresentationStyle = {
  fullScreen: 'fullScreen',
  pageSheet: 'pageSheet',
  formSheet: 'formSheet',
  currentContext: 'currentContext',
  overFullScreen: 'overFullScreen',
  overCurrentContext: 'overCurrentContext',
  popover: 'popover',
  automatic: 'automatic',
};

function _mimeFiltersFor(mediaTypes) {
  // Accept upstream's legacy string OR the v15+ MediaType[] array.
  if (Array.isArray(mediaTypes)) {
    const out = [];
    for (const t of mediaTypes) {
      if (t === 'images') out.push('image/*');
      else if (t === 'videos') out.push('video/*');
      else if (t === 'livephotos') out.push('image/*'); // no Linux equivalent
    }
    return out.length ? out : ['image/*'];
  }
  switch (mediaTypes) {
    case MediaTypeOptions.Videos:
      return ['video/*'];
    case MediaTypeOptions.All:
      return ['image/*', 'video/*'];
    case MediaTypeOptions.Images:
    default:
      return ['image/*'];
  }
}

// Copy a picked file into the app's cache so the consumer can
// rely on the URI not changing or vanishing. Used for the typical
// expo-image-picker flow where the picked file gets re-read /
// uploaded later.
function _copyToCache(srcPath, filename) {
  const c = rnLinux.fsConstants();
  const cacheDir = (c && c.cacheDirectory ? c.cacheDirectory : 'file:///tmp/').replace(
    'file://',
    '',
  );
  const subdir = `${cacheDir}ImagePicker/`;
  rnLinux.fsMakeDirectory(subdir, true);
  const safe = (filename || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const dest = `${subdir}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  rnLinux.fsCopy(srcPath, dest);
  return dest;
}

function _toAsset(file, copyToCache) {
  // gdk_pixbuf_get_file_info filled in width/height for images on
  // the native side; GstDiscoverer filled in width/height/duration
  // for videos. 0 is "unknown" (format we can't parse); upstream
  // uses null for unknown.
  let path = file.path;
  if (copyToCache) {
    try {
      path = _copyToCache(file.path, file.name);
    } catch (_) {}
  }
  const w = typeof file.width === 'number' && file.width > 0 ? file.width : null;
  const h = typeof file.height === 'number' && file.height > 0 ? file.height : null;
  const duration =
    typeof file.durationMs === 'number' && file.durationMs > 0 ? file.durationMs / 1000 : null;
  return {
    uri: 'file://' + path,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.mimeType || null,
    type: file.mimeType && file.mimeType.startsWith('video/') ? 'video' : 'image',
    width: w,
    height: h,
    duration,
  };
}

async function launchImageLibraryAsync(options) {
  if (!_hasNative) {
    throw new Error('expo-image-picker: native rnLinux.pickFiles not bound');
  }
  // expo-image-picker doesn't expose copyToCacheDirectory the way
  // expo-document-picker does, but the same isolation matters —
  // picked images often live in dirs the user might move/delete.
  // Always copy unless the caller explicitly opts out via the
  // Linux-only `_copyToCache: false` extension option.
  const copyToCache = options?._copyToCache !== false;
  return new Promise((resolve, reject) => {
    rnLinux.pickFiles(
      {
        title: 'Choose an image',
        mimeFilters: _mimeFiltersFor(options?.mediaTypes ?? MediaTypeOptions.Images),
        multiple: options?.allowsMultipleSelection === true,
      },
      result => {
        if (result.canceled) {
          resolve({canceled: true, assets: null});
          return;
        }
        resolve({canceled: false, assets: result.assets.map(f => _toAsset(f, copyToCache))});
      },
      msg => reject(new Error(msg)),
    );
  });
}

async function launchCameraAsync(_options) {
  if (!_hasCamera) {
    throw new Error('expo-image-picker: native rnLinux.cameraSnap not bound');
  }
  // Chain into the existing camera snap pipeline (videotestsrc or
  // v4l2src). One-shot PNG is what most "take a photo" callers
  // expect; video capture would be a follow-up.
  return new Promise((resolve, reject) => {
    rnLinux.cameraSnap(
      r =>
        resolve({
          canceled: false,
          assets: [
            {
              uri: r.uri,
              width: r.width,
              height: r.height,
              fileName: r.uri.split('/').pop() ?? null,
              mimeType: 'image/png',
              type: 'image',
              duration: null,
            },
          ],
        }),
      msg => reject(new Error(msg)),
    );
  });
}

// Permissions — Linux's library / camera access is governed by
// filesystem perms + device perms, not a per-app gate the JS
// layer can prompt for. Return granted so cross-platform code
// proceeds.
function _granted() {
  return {status: 'granted', granted: true, canAskAgain: true, expires: 'never'};
}
async function getMediaLibraryPermissionsAsync() {
  return _granted();
}
async function requestMediaLibraryPermissionsAsync() {
  return _granted();
}
async function getCameraPermissionsAsync() {
  return _granted();
}
async function requestCameraPermissionsAsync() {
  return _granted();
}

async function getPendingResultAsync() {
  // Android-only — used when the picker activity is killed and
  // result delivered through onResume. No equivalent on Linux;
  // return [] so cross-platform code that always checks doesn't
  // crash.
  return [];
}

const api = {
  MediaTypeOptions,
  MediaType,
  CameraType,
  ImagePickerOrderBy,
  VideoExportPreset,
  UIImagePickerControllerQualityType,
  UIImagePickerPresentationStyle,
  launchImageLibraryAsync,
  launchCameraAsync,
  getMediaLibraryPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
  getCameraPermissionsAsync,
  requestCameraPermissionsAsync,
  getPendingResultAsync,
};

module.exports = api;
module.exports.default = api;
