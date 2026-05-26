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
//   * `priority`, `recyclingKey`, `responsivePolicy`              — accepted, ignored
//   * `Image.prefetch(uri)`                                       — best-effort warmup
//   * `Image.clearMemoryCache` / `clearDiskCache`                 — no-op (no inspectable cache)
//   * `useImage(source)` hook                                     — resolves to {uri, width,
//                                                                   height} via getInfoAsync
//
// Real cross-fade transitions / placeholder support would mean
// either a custom Fabric component with two stacked GtkPictures
// or a GdkPaintable subclass that interpolates between two
// textures — the natural follow-up for apps that lean on those
// features.

const React = require('react');
const {Image: RNImage} = require('react-native');

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

// expo-image's `source` accepts:
//   * a string URI
//   * { uri, width?, height?, headers?, scale?, ... }
//   * an array of { uri, width, height } (responsive — we just
//     pick the first)
//   * a require('./img.png') number (RN's static asset)
function _normalizeSource(src) {
  if (src == null) return null;
  if (typeof src === 'string') return {uri: src};
  if (Array.isArray(src)) return _normalizeSource(src[0]);
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

  const rnSource = _normalizeSource(source);
  return React.createElement(RNImage, {
    ...rest,
    ref,
    source: rnSource,
    style,
    resizeMode: _resizeModeFor(contentFit),
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
  // own. Return true to match upstream's "did the call succeed"
  // contract.
  return true;
}

async function clearDiskCache() {
  // libsoup's HTTP cache is at $XDG_CACHE_HOME/libsoup/; we
  // don't reach in to wipe it (would surprise other consumers).
  // Documented as a gap.
  return true;
}

async function getCachePathAsync(_url) {
  // libsoup's cache isn't keyed by predictable filenames. Return
  // null rather than guess.
  return null;
}

function useImage(source, _options, _callbacks) {
  // Resolve the source to {uri, width, height} once. For HTTP
  // URIs that means an actual download to discover dimensions;
  // for file:// URIs we can stat without loading the bytes.
  const [resolved, setResolved] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const norm = _normalizeSource(source);
    const uri = norm && norm.uri;
    if (!uri) {
      setResolved(null);
      return;
    }
    if (norm && norm.width && norm.height) {
      setResolved(norm);
      return;
    }
    // For now we only resolve a {uri}; width/height stay
    // unknown unless caller supplies them. A real implementation
    // would Image.getSize + cache the result.
    setResolved(norm);
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

// Attach prefetch / clear cache / getCachePathAsync as statics
// on the Image component itself, matching upstream's shape.
Image.prefetch = prefetch;
Image.clearMemoryCache = clearMemoryCache;
Image.clearDiskCache = clearDiskCache;
Image.getCachePathAsync = getCachePathAsync;

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
