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

| API                                                                                 | Behavior on Linux                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `<Image source={uri/object/array}>`                                                 | Real — string / {uri} / array (first entry) / RN asset id              |
| `contentFit`                                                                        | Mapped to `resizeMode` (cover/contain/fill/center; scale-down→contain) |
| `onLoadStart / onLoad / onLoadEnd / onError`                                        | Forwarded to RN.Image                                                  |
| `placeholder` / `placeholderContentFit`                                             | Accepted, ignored (no cross-fade support)                              |
| `transition`                                                                        | Accepted, ignored                                                      |
| `cachePolicy`                                                                       | Accepted, ignored (libsoup has its own HTTP cache)                     |
| `priority` / `recyclingKey` / `responsivePolicy`                                    | Accepted, ignored                                                      |
| `blurRadius`                                                                        | Accepted, ignored                                                      |
| `autoplay` / `allowDownscaling`                                                     | Accepted, ignored                                                      |
| `<ImageBackground>`                                                                 | Real — Image nested under absolutely-positioned children               |
| `Image.prefetch(uri)`                                                               | Warms libsoup cache via downloadAsync + delete                         |
| `Image.clearMemoryCache / clearDiskCache`                                           | No-op returning `true`                                                 |
| `Image.getCachePathAsync(uri)`                                                      | Returns `null` (libsoup cache isn't predictably keyed)                 |
| `useImage(source)` hook                                                             | Resolves source to `{uri}` (width/height stay unknown)                 |
| `ImageContentFit / ImageContentPosition / ImageCachePolicy / ImageTransition` enums | Match upstream string/object values                                    |

## Known gaps

- **No placeholder cross-fade.** A real implementation would
  layer a placeholder texture under the real one and fade with
  cairo opacity. Would mean either a new Fabric component or a
  GdkPaintable subclass that interpolates between two child
  paintables.
- **No blur.** Would need a GdkPaintable that runs a Gaussian
  blur shader (or cairo CPU blur) over its source paintable.
- **No advanced cache control.** libsoup's HTTP cache is at
  `$XDG_CACHE_HOME/libsoup/`; we don't peek in or wipe it.
  `clearDiskCache` returns true but does nothing — fixing would
  mean either inspecting libsoup's cache directory directly or
  swapping the loader for one we fully control.
- **`useImage` returns only `{uri}`.** No width / height
  resolution since that would mean either parsing the image
  header (gdk-pixbuf) or fully loading it. `Image.getSize` from
  RN exists but isn't routed yet.
- **No `responsivePolicy`-driven source selection** beyond
  picking the first array entry. Picking based on display scale
  - pixel density would need the Dimensions hook + a per-render
    pick.
- **No animated image (GIF/WebP) support beyond what GTK gives
  us natively.** GdkPixbufAnimation works through gdk-pixbuf-
  loader plugins (gdk-pixbuf-jpeg / -gif / -webp), but our
  current loader path uses `gdk_texture_new_*` which decodes a
  single frame. Animated images render as the first frame.
