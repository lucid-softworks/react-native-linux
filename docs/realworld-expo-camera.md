# Real-app harness: expo-camera via GStreamer

`expo-camera` ships a JS surface that combines an imperative API
(permissions, `takePictureAsync`, `recordAsync`) with a live preview
host component (`<CameraView>`). Both halves are real on Linux:
preview frames flow through GStreamer + `GdkMemoryTexture` into a
GtkPicture, and `takePictureAsync` runs a one-shot GStreamer pipeline
that writes a PNG to disk.

## Architecture

```
JS app
  ↓ require('expo-camera')        ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-camera.js
  ├─ CameraView  → React.createElement('camera', …)
  │                  ↓
  │                fabricHostConfig.js (createInstance type='camera')
  │                  ↓ createNode('CameraView', …)
  │                Fabric → CameraComponentView (vnext/src/views)
  │                  ↓
  │                GtkPicture ←─── frames ──── Preview (Camera.cpp)
  │                                              ↓
  │                                         GStreamer pipeline
  │                                         videotestsrc|v4l2src →
  │                                         videoconvert →
  │                                         videoscale →
  │                                         videorate →
  │                                         RGBA caps →
  │                                         appsink (emit-signals=true)
  │                                              ↓
  │                                         g_idle_add →
  │                                         GdkMemoryTexture →
  │                                         gtk_picture_set_paintable
  │
  └─ takePictureAsync → rnLinux.cameraSnap (JSI)
                          ↓
                        gst_parse_launch
                          source ! videoconvert ! videoscale !
                          width=640,height=480 !
                          pngenc ! filesink location=…
                          (num-buffers=1 → EOS → callback)
                          ↓
                        {uri:'file:///…/snap-…png', width, height}
```

`<CameraView>` mounts/unmounts trigger `Preview` start/stop; the
pipeline only runs while a view is alive. `cameraSnap` runs a fresh
short pipeline for each call, so snapping doesn't disturb the
preview's appsink.

## VM / host setup

```sh
sudo apt install -y \
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-tools
```

- `gstreamer1.0-plugins-base` carries videotestsrc / videoconvert /
  videoscale / videorate / appsink.
- `gstreamer1.0-plugins-good` carries pngenc.
- `gstreamer1.0-tools` is optional — handy for `gst-inspect-1.0` and
  `gst-launch-1.0` when debugging pipeline issues.

No camera hardware is required. If `/dev/video0` is absent (Lima
dev VMs, headless CI), the C++ side substitutes
`videotestsrc pattern=smpte` so the CameraView still shows a real
texture (classic colour bars) and `takePictureAsync` still returns a
real PNG.

## Why not gtk4paintablesink?

The upstream Rust crate `gst-plugin-gtk4` exposes a `gtk4paintablesink`
element that hands a `GdkPaintable` directly to GtkPicture — no
copies, GL-accelerated where available. Ubuntu 24.04 doesn't package
it as a binary (`librust-gst-plugin-gtk4-dev` is source only), so we
take the slightly slower but binary-free path: `appsink` →
`gdk_memory_texture_new` → `gtk_picture_set_paintable`. Worth
revisiting when the Rust plugin lands as a `.deb`.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

Scroll to the `expo-camera` section. The probe row shows
`perms=granted native=on`; the demo below mounts a `<CameraView>`
showing live frames, and the `snap` button writes a PNG that's
rendered inline via `<Image>`.

## API surface

| API                                           | Behavior on Linux                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `<CameraView />`                              | Real live preview via Fabric → GtkPicture + GStreamer appsink                                     |
| `<Camera />`                                  | Alias for `CameraView` (upstream's pre-v14 name)                                                  |
| `requestCameraPermissionsAsync`               | Returns `granted` — perms map to file-system access on Linux                                      |
| `requestMicrophonePermissionsAsync`           | Same                                                                                              |
| `getCameraPermissionsAsync` / `getMic…`       | Same                                                                                              |
| `takePictureAsync({})`                        | Real PNG written to `$XDG_CACHE_HOME/rn-linux/snap-…png`                                          |
| `getAvailableCameraTypesAsync`                | Real — probes `/sys/class/video4linux/`, returns `['front']` or `['front','back']` based on count |
| `isAvailableAsync`                            | True if `rnLinux.cameraSnap` is bound                                                             |
| `recordAsync` / `stopRecording`               | Throws "not implemented" — no encoder pipeline yet                                                |
| `getAvailableVideoStabilizationModesAsync`    | Returns `[]`                                                                                      |
| `getAvailablePictureSizesAsync`               | Returns `['640x480']` (hardcoded — matches the snap pipeline)                                     |
| `Accuracy` / `FlashMode` / `CameraType` enums | Surface-only; preview pipeline doesn't react to them yet                                          |

## Known gaps

- **Video recording** is unimplemented. Adding it means a longer
  pipeline (`videoconvert ! videorate ! x264enc ! mp4mux ! filesink`),
  hooking start/stop into `recordAsync`/`stopRecording`, and dealing
  with audio (`pulsesrc/pipewiresrc`). Out of scope for the smoke
  demo.
- **CameraView props don't flow into the pipeline.** `facing`,
  `flash`, `zoom`, `ratio` etc. are accepted at the shadow-node /
  JS level but the native side doesn't react. Rebuilding the
  pipeline on prop change would be straightforward; tracking the
  state across mounts is the harder part.
- **Single device per pipeline.** The snap path opens its own
  pipeline; if `/dev/video0` is real hardware (V4L2 single-open),
  snapping while a preview is mounted will fail. Test-source path is
  unaffected (videotestsrc is freely reentrant).
- **Base64 / EXIF in takePictureAsync result** is omitted. Adding
  `base64` would double the per-snap cost; EXIF would require an
  EXIF writer in the pipeline (`jpegenc + jifmux` instead of
  `pngenc`).
- **Active device enumeration** — **DONE.** A new
  `v4l2CaptureDeviceCount()` walks `/sys/class/video4linux/`,
  filters out non-capture nodes (vbi/radio/swradio + driver
  names containing "decoder"/"encoder"/"output"), and feeds
  `getAvailableCameraTypesAsync`. Returns `['front']` for
  single-device laptops, `['front','back']` for 2+, and
  `['front']` on the VM test-source path so CameraView still
  mounts. V4L2 has no portable facing signal, so the front/back
  split is a count-based heuristic — fine for the laptop+USB
  webcam case, not a real per-device classifier.
