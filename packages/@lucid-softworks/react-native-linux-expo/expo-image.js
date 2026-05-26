'use strict';

// Shim for `expo-image`. Renders through RN's <Image> — which on
// Linux is backed by vnext/src/views/ImageComponentView.cpp (GTK
// GtkPicture + libsoup async loader for HTTP, gdk_texture_new_*
// for file:// and base64). The core load + display path is real.
//
// What's faithful vs not:
//   * `source` with file://, http(s)://, base64 data URIs        — real
//   * `contentFit` (cover/contain/fill/scale-down/none)           — mapped to RN resizeMode
//   * `onLoad` / `onError`                                        — forwarded
//   * `style` (width, height, borderRadius, borderColor, etc.)    — forwarded
//   * `placeholder` (shown while real source loads)               — accepted, ignored
//                                                                   (no two-image cross-fade
//                                                                   in our ImageComponentView)
//   * `transition` (fade duration on load)                        — accepted, ignored
//   * `cachePolicy` (none / disk / memory / memory-disk)          — accepted, ignored
//                                                                   (libsoup has its own cache)
//   * `blurRadius`                                                — accepted, ignored
//                                                                   (would need a GdkPaintable
//                                                                   subclass with cairo blur)
//   * `priority`, `recyclingKey`                                  — accepted, ignored
//   * `responsivePolicy`                                          — real; drives array-source picker
//   * `Image.prefetch(uri)`                                       — best-effort warmup
//   * `Image.clearDiskCache` / `clearMemoryCache`                 — real; wipes the SoupCache
//                                                                   the HTTP image fetcher attaches
//                                                                   under XDG_CACHE_HOME/rn-linux-
//                                                                   playground/soup-image-cache
//   * `useImage(source)` hook                                     — resolves to {uri, width,
//                                                                   height} via getInfoAsync
//
// Real cross-fade transitions / placeholder support would mean
// either a custom Fabric component with two stacked GtkPictures
// or a GdkPaintable subclass that interpolates between two
// textures — the natural follow-up for apps that lean on those
// features.

const React = require('react');
const {Image: RNImage, PixelRatio: ReactNativePixelRatio} = require('react-native');

// expo-image's `contentFit` ↔ RN's `resizeMode`. expo also has
// 'scale-down' which RN doesn't; map to 'contain' (closest
// behavior — never upscale).
function _resizeModeFor(contentFit) {
  switch (contentFit) {
    case 'fill':
      return 'stretch';
    case 'contain':
    case 'scale-down':
      return 'contain';
    case 'none':
      return 'center';
    case 'cover':
    default:
      return 'cover';
  }
}

// Pick the best source out of an array based on display scale and
// optional render width. expo's `responsivePolicy` options:
//   'static' (default) — pick by display scale only, fixed at mount
//   'initial'          — same as static
//   'live'             — re-pick on every render (we approximate via
//                         the calling component re-running this with
//                         current state, since the policy only
//                         affects React re-renders)
// Entries with `scale` near the current display scale win; ties
// break by closer pixel width to the rendered width hint. Falls
// back to the first entry when no entry has either field.
function _pickResponsive(arr, policy, renderWidthPx) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (arr.length === 1) return arr[0];
  const targetScale = ReactNativePixelRatio.get();
  // Score each candidate. Lower is better. Missing scale defaults
  // to 1 (the iOS @1x convention). Missing width skips the width
  // term so entries without it stay in contention.
  let best = arr[0];
  let bestScore = Infinity;
  for (const candidate of arr) {
    if (!candidate || typeof candidate !== 'object') continue;
    const candScale = typeof candidate.scale === 'number' ? candidate.scale : 1;
    const scaleDelta = Math.abs(candScale - targetScale);
    let widthDelta = 0;
    if (typeof renderWidthPx === 'number' && typeof candidate.width === 'number') {
      // Penalize undersized candidates more (5x) than oversized —
      // upscaling looks worse than downscaling at the same delta.
      const candWidthInPx = candidate.width * candScale;
      const diff = candWidthInPx - renderWidthPx * targetScale;
      widthDelta = diff < 0 ? -diff * 5 : diff;
    }
    const score = scaleDelta * 1000 + widthDelta;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

// expo-image's `source` accepts:
//   * a string URI
//   * { uri, width?, height?, headers?, scale?, ... }
//   * an array of { uri, width, height, scale? } (responsive)
//   * a require('./img.png') number (RN's static asset)
function _normalizeSource(src, opts) {
  if (src == null) return null;
  if (typeof src === 'string') return {uri: src};
  if (Array.isArray(src)) {
    const pick = _pickResponsive(src, opts?.policy, opts?.renderWidthPx);
    return _normalizeSource(pick, opts);
  }
  if (typeof src === 'object' && (src.uri || src.localUri || typeof src === 'number')) {
    if (src.localUri && !src.uri) return {...src, uri: src.localUri};
    return src;
  }
  if (typeof src === 'number') return src; // RN asset id
  return null;
}

const Image = React.forwardRef(function ExpoImage(props, ref) {
  const {
    source,
    contentFit = 'cover',
    placeholder: _placeholder,
    placeholderContentFit: _placeholderFit,
    transition: _transition,
    cachePolicy: _cachePolicy,
    priority: _priority,
    blurRadius: _blurRadius,
    recyclingKey: _recyclingKey,
    responsivePolicy: _responsivePolicy,
    autoplay: _autoplay,
    allowDownscaling: _allowDownscaling,
    enableLiveTextInteraction: _enableLiveText,
    onLoadStart,
    onProgress: _onProgress,
    onLoadEnd,
    onLoad,
    onError,
    style,
    ...rest
  } = props;

  // Track measured width so the responsive picker has something
  // better than the display scale to decide on. The first render
  // uses just the scale; subsequent renders narrow in once
  // onLayout reports a real px width.
  const [renderWidthPx, setRenderWidthPx] = React.useState(undefined);
  const callerOnLayout = rest.onLayout;
  const onLayout = React.useCallback(
    e => {
      const w = e?.nativeEvent?.layout?.width;
      if (typeof w === 'number' && w > 0) setRenderWidthPx(w);
      if (callerOnLayout) callerOnLayout(e);
    },
    [callerOnLayout],
  );
  const rnSource = _normalizeSource(source, {policy: _responsivePolicy, renderWidthPx});
  return React.createElement(RNImage, {
    ...rest,
    ref,
    source: rnSource,
    style,
    resizeMode: _resizeModeFor(contentFit),
    onLayout,
    onLoadStart,
    onLoadEnd,
    onLoad,
    onError,
  });
});

// ImageBackground — render the image AND children on top. We
// nest a <View> for the children layer to match upstream's
// behavior of treating children as absolutely-positioned content.
const ImageBackground = React.forwardRef(function ExpoImageBackground(props, ref) {
  const {children, imageStyle, style, ...imgProps} = props;
  const {View} = require('react-native');
  return React.createElement(
    View,
    {style},
    React.createElement(Image, {
      ...imgProps,
      ref,
      style: [{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}, imageStyle],
    }),
    children,
  );
});

// Image.prefetch: upstream warms the disk + memory cache so
// subsequent renders show instantly. libsoup has its own cache;
// the cheapest thing we can do is issue a fetch and discard the
// result, which populates the cache for the next request. We
// reach for rnLinux.fsDownload + rnLinux.fsDelete directly —
// `require('expo-file-system')` from inside this shim bypasses
// our metro alias when esbuild bundles vendor and resolves to
// the upstream npm package (which throws on requireNativeModule).
async function prefetch(uri, _cachePolicy, _headers) {
  if (
    typeof rnLinux === 'undefined' ||
    typeof rnLinux.fsDownload !== 'function' ||
    typeof rnLinux.fsConstants !== 'function'
  ) {
    return false;
  }
  const c = rnLinux.fsConstants();
  const dir = (c && c.cacheDirectory ? c.cacheDirectory : 'file:///tmp/').replace('file://', '');
  const tmp = `${dir}img-prefetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise(resolve => {
    rnLinux.fsDownload(
      uri,
      tmp,
      {},
      null,
      () => {
        try {
          rnLinux.fsDelete(tmp, true);
        } catch (e) {}
        resolve(true);
      },
      () => resolve(false),
    );
  });
}

async function clearMemoryCache() {
  // libsoup's cache is on disk; no in-memory texture cache we
  // own. Falls through to clearDiskCache so the "make sure my
  // next fetch is fresh" intent is preserved.
  return clearDiskCache();
}

async function clearDiskCache() {
  // Real — the image SoupSession has a SoupCache attached at
  // XDG_CACHE_HOME/rn-linux-playground/soup-image-cache. The
  // native binding wipes both the in-memory entries and the
  // on-disk files, so the next HTTP fetch is guaranteed to hit
  // the network.
  if (typeof rnLinux !== 'undefined' && typeof rnLinux.imageClearCache === 'function') {
    return Boolean(rnLinux.imageClearCache());
  }
  return false;
}

async function getCachePathAsync(_url) {
  // SoupCache keys responses by a SHA-1 of the URL — derivable
  // but not a stable contract. Return the cache directory itself
  // so the path is at least useful for `du -sh`-style checks.
  if (typeof rnLinux !== 'undefined' && typeof rnLinux.imageCacheDir === 'function') {
    return String(rnLinux.imageCacheDir());
  }
  return null;
}

// Resolve the pixel dimensions of an image URI. For file:// paths
// we call gdk_pixbuf_get_file_info directly (header-only, no
// decode). For http(s):// we download to a temp file via the
// libsoup-backed fsDownload then probe the same way; the file is
// unlinked after the probe so this doesn't grow the cache. Data
// URIs decode the base64 body to a temp file first.
async function _getImageSize(uri) {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.imageGetFileSize !== 'function') {
    return {width: 0, height: 0};
  }
  if (typeof uri !== 'string' || !uri) return {width: 0, height: 0};
  if (uri.startsWith('file://')) {
    return rnLinux.imageGetFileSize(uri.slice('file://'.length));
  }
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    if (comma < 0 || !uri.slice(5, comma).includes(';base64')) return {width: 0, height: 0};
    let dir = '/tmp/';
    if (typeof rnLinux.fsConstants === 'function') {
      const c = rnLinux.fsConstants();
      if (c && c.cacheDirectory) dir = c.cacheDirectory.replace('file://', '');
    }
    const dest = `${dir}image-size-${Date.now()}.bin`;
    rnLinux.fsWriteString(dest, uri.slice(comma + 1), 'base64');
    try {
      return rnLinux.imageGetFileSize(dest);
    } finally {
      try {
        rnLinux.fsDelete(dest, true);
      } catch (_) {}
    }
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    if (typeof rnLinux.fsDownload !== 'function') return {width: 0, height: 0};
    let dir = '/tmp/';
    if (typeof rnLinux.fsConstants === 'function') {
      const c = rnLinux.fsConstants();
      if (c && c.cacheDirectory) dir = c.cacheDirectory.replace('file://', '');
    }
    const dest = `${dir}image-size-${Date.now()}.bin`;
    await new Promise((resolve, reject) => {
      rnLinux.fsDownload(
        uri,
        dest,
        {},
        null,
        () => resolve(),
        msg => reject(new Error(msg)),
      );
    });
    try {
      return rnLinux.imageGetFileSize(dest);
    } finally {
      try {
        rnLinux.fsDelete(dest, true);
      } catch (_) {}
    }
  }
  return {width: 0, height: 0};
}

function useImage(source, _options, _callbacks) {
  // Resolve the source to {uri, width, height}. file:// reads the
  // dimensions synchronously off the image header; http(s):// goes
  // through the libsoup fetcher to a temp path first. The
  // resolved state populates incrementally — uri first, then w/h
  // when the probe lands — so consumers can render the placeholder
  // box at the right ratio without waiting on a full decode.
  // useImage has no layout pass to read a render-width from, so
  // we let the responsive picker choose by display scale alone.
  const [resolved, setResolved] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const norm = _normalizeSource(source, {policy: 'initial'});
    const uri = norm && norm.uri;
    if (!uri) {
      setResolved(null);
      return;
    }
    if (norm && norm.width && norm.height) {
      setResolved(norm);
      return;
    }
    setResolved(norm);
    _getImageSize(uri).then(({width, height}) => {
      if (cancelled) return;
      if (width > 0 && height > 0) {
        setResolved(prev => ({...(prev || norm), width, height}));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source]);
  return resolved;
}

const ImageContentFit = {
  cover: 'cover',
  contain: 'contain',
  fill: 'fill',
  none: 'none',
  scaleDown: 'scale-down',
};

const ImageContentPosition = {
  center: 'center',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
  topLeft: 'top left',
  topRight: 'top right',
  bottomLeft: 'bottom left',
  bottomRight: 'bottom right',
};

const ImageCachePolicy = {
  none: 'none',
  disk: 'disk',
  memory: 'memory',
  memoryDisk: 'memory-disk',
};

const ImageTransition = {
  duration: 0,
  effect: 'cross-dissolve',
  timing: 'ease-in-out',
};

// Attach prefetch / clear cache / getCachePathAsync / getSize as
// statics on the Image component itself, matching upstream's shape.
Image.prefetch = prefetch;
Image.clearMemoryCache = clearMemoryCache;
Image.clearDiskCache = clearDiskCache;
Image.getCachePathAsync = getCachePathAsync;
// RN-style callback form and expo-image's Promise form. Both route
// through the same gdk_pixbuf_get_file_info-backed probe.
Image.getSize = function getSize(uri, onSuccess, onError) {
  _getImageSize(uri).then(
    ({width, height}) => {
      if (width > 0 && height > 0) {
        if (onSuccess) onSuccess(width, height);
      } else if (onError) {
        onError(new Error(`expo-image: getSize couldn't read ${uri}`));
      }
    },
    err => {
      if (onError) onError(err);
    },
  );
};
Image.getSizeAsync = async function getSizeAsync(uri) {
  const {width, height} = await _getImageSize(uri);
  if (width <= 0 || height <= 0) {
    throw new Error(`expo-image: getSizeAsync couldn't read ${uri}`);
  }
  return {width, height};
};

const api = {
  Image,
  ImageBackground,
  useImage,
  ImageContentFit,
  ImageContentPosition,
  ImageCachePolicy,
  ImageTransition,
};

module.exports = api;
module.exports.default = api;
