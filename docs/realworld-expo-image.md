# Real-app harness: expo-image (over RN.Image)

`expo-image`'s `<Image>` renders through React Native's `<Image>`,
which on Linux is backed by the existing
`vnext/src/views/ImageComponentView.cpp` — GtkPicture +
gdk*texture_new*\* for local sources, libsoup async loader for
HTTP(S). The display path is real; the advanced expo-image
extras (placeholder, transition, cachePolicy, blurRadius) are
accepted as props but no-ops today.

## Architecture

```
JS app
  ↓ require('expo-image').Image
@lucid-softworks/.../expo-image.js
  ├─ contentFit → RN resizeMode
  ├─ source normalization (string | {uri} | array | RN asset)
  ├─ onLoad / onError / style forwarded
  ├─ placeholder / transition / cachePolicy / blurRadius — discarded
  └─ Image.prefetch → expo-file-system.downloadAsync (warm libsoup cache)
  ↓
React Native <Image>
  ↓ Fabric → Image native component
ImageComponentView (vnext/src/views/ImageComponentView.cpp)
  ├─ file:// → gdk_texture_new_from_file
  ├─ data:image/* base64 → gdk_texture_new_from_bytes
  └─ https?:// → libsoup async fetch → gdk_texture_new_from_bytes
  → gtk_picture_set_paintable
```

## Architecture decision: why no new Fabric component

A faithful expo-image implementation would have its own native
view to support:

- placeholder + cross-fade transitions (two stacked textures
  with opacity interpolation)
- cachePolicy honoring (manage an in-process texture cache
  beyond libsoup's HTTP cache)
- blurRadius (a custom GdkPaintable that applies a cairo blur
  per frame)

That's a CameraView-sized native component on top of RN.Image's
existing one. For the smoke-demo tier of effort, wrapping RN.Image
gives 90% of the value (real loading, content-fit, error
handling) with 10% of the code. The expensive native work is a
follow-up if real apps depend on the cross-fade or blur.

## VM / host setup

Nothing. ImageComponentView is already wired; libsoup is already
linked.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The expo-image section renders a sample HTTPS PNG via
`<Image contentFit="contain" source={{uri:'…'}} />`.

## API surface

| API                                                                                 | Behavior on Linux                                                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `<Image source={uri/object/array}>`                                                 | Real — string / {uri} / RN asset id; arrays drive responsive selection by scale + measured width                |
| `contentFit`                                                                        | Mapped to `resizeMode` (cover/contain/fill/center; scale-down→contain)                                          |
| `onLoadStart / onLoad / onLoadEnd / onError`                                        | Forwarded to RN.Image                                                                                           |
| `placeholder` / `placeholderContentFit`                                             | Accepted, ignored (no cross-fade support)                                                                       |
| `transition`                                                                        | Accepted, ignored                                                                                               |
| `cachePolicy`                                                                       | Accepted, ignored (libsoup has its own HTTP cache)                                                              |
| `priority` / `recyclingKey`                                                         | Accepted, ignored                                                                                               |
| `responsivePolicy`                                                                  | Real — drives the array-source picker (display scale + render-width score)                                      |
| animated GIF / WebP / APNG                                                          | Real — routed through `GtkMediaFile` (loops, plays); other formats use the static `GdkTexture` path             |
| `blurRadius`                                                                        | Accepted, ignored                                                                                               |
| `autoplay` / `allowDownscaling`                                                     | Accepted, ignored                                                                                               |
| `<ImageBackground>`                                                                 | Real — Image nested under absolutely-positioned children                                                        |
| `Image.prefetch(uri)`                                                               | Warms libsoup cache via downloadAsync + delete                                                                  |
| `Image.clearMemoryCache / clearDiskCache`                                           | Real — wipes the SoupCache under XDG_CACHE_HOME/.../soup-image-cache                                            |
| `Image.getCachePathAsync(uri)`                                                      | Returns the cache directory path (entries are SHA-1-keyed, not stable)                                          |
| `useImage(source)` hook + `Image.getSize` / `getSizeAsync`                          | Real — `gdk_pixbuf_get_file_info` for file://, libsoup download + probe for http(s)://, base64 decode for data: |
| `ImageContentFit / ImageContentPosition / ImageCachePolicy / ImageTransition` enums | Match upstream string/object values                                                                             |

## Known gaps

- **No placeholder cross-fade.** A real implementation would
  layer a placeholder texture under the real one and fade with
  cairo opacity. Would mean either a new Fabric component or a
  GdkPaintable subclass that interpolates between two child
  paintables.
- **No blur.** Would need a GdkPaintable that runs a Gaussian
  blur shader (or cairo CPU blur) over its source paintable.
- **Advanced cache control** — **DONE.** The HTTP fetcher attaches
  a `SoupCache` at
  `$XDG_CACHE_HOME/rn-linux-playground/soup-image-cache` so cached
  responses survive process restarts. `Image.clearDiskCache()`
  drives `soup_cache_clear()` + `soup_cache_flush()` and unlinks
  any lingering files; `Image.getCachePathAsync()` returns the
  cache directory. Per-URL cache lookup isn't surfaced because
  SoupCache keys by a SHA-1 hash that isn't a stable contract.
- **`useImage` width / height** — **DONE.** Backed by a new
  `imageGetFileSize` JSI binding that calls
  `gdk_pixbuf_get_file_info` on the underlying path (header read,
  no decode). The shim downloads http(s):// to a temp file via
  `fsDownload` first, decodes data: URIs through `fsWriteString`,
  and treats file:// as direct. `Image.getSize` (RN-style
  callback) and `Image.getSizeAsync` (Promise) route through the
  same probe.
- **`responsivePolicy`-driven source selection** — **DONE.** When
  `source` is an array, the shim picks the best entry by display
  scale (`PixelRatio.get()`) and rendered width: candidates with
  scale closest to the device scale win, ties broken by width
  closest to the layout-measured pixel width. Undersized
  candidates score worse than oversized (upscaling looks worse
  than downscaling at the same delta). `useImage` runs the same
  picker but without a width hint (no layout pass to read from).
- **Animated image (GIF / WebP / APNG)** — **DONE.** Files with
  those extensions route through `GtkMediaFile` instead of
  `GdkTexture`. GtkMediaFile owns a GStreamer pipeline that
  decodes frames in real time, loops, and exposes a GdkPaintable
  GtkPicture can render directly. HTTP fetches write the
  response bytes to a temp file under
  `imageCacheDir()/anim/http-<seq>-<ts>.bin` before handing off
  to GtkMediaFile (which only loads from file URIs). Static
  formats stay on the `gdk_texture_new_*` fast path.
