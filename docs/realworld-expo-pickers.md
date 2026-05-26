# Real-app harness: expo-document-picker + expo-image-picker

Both pickers share one C++ backend: `gtk_file_dialog_open` /
`gtk_file_dialog_open_multiple` (GTK 4.10+'s replacement for the
deprecated `GtkFileChooserDialog`). One JSI binding,
`rnLinux.pickFiles`, handles both; the JS shims layer their
respective semantics (MIME filters, "library vs camera" dispatch,
asset-shape conversion) on top.

## Architecture

```
JS app
  ↓ require('expo-document-picker')  or require('expo-image-picker')
  ↓
@lucid-softworks/.../expo-document-picker.js   ── getDocumentAsync({type})
@lucid-softworks/.../expo-image-picker.js      ── launchImageLibraryAsync({mediaTypes})
                                                  launchCameraAsync()   →  rnLinux.cameraSnap
                                                  (reuses the existing expo-camera pipeline)
  ↓ rnLinux.pickFiles({title, mimeFilters[], multiple}, ok, err)
  ↓
vnext/src/filepicker/FilePicker.cpp
  ├─ gtk_file_dialog_new + set_modal + set_title + set_filters
  ├─ gtk_file_dialog_open(_multiple) — async, parented to GtkApplicationWindow
  └─ async callback → vector<PickedFile{path,name,size,mimeType}>
                       (size via stat, mime via gio's content-type machinery)
```

GTK's `GTK_DIALOG_ERROR_DISMISSED` is reported as `canceled: true`
rather than an error — matches upstream's "canceled is a normal
return value" contract.

## MIME filter handling

GtkFileFilter doesn't expand mime wildcards like `image/*`, so
the backend adds both the literal mime AND a set of common
extension patterns (`*.png`, `*.jpg`, …) for `image/`, `video/`,
and `audio/`. Name-based fallbacks catch files on systems where
the mime detection isn't fully populated; the mime check catches
the rest.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

Two demos in the smoke test:

- **expo-document-picker:** `pick one` / `pick multiple` buttons.
  GtkFileDialog opens modal-to-the-playground window; cancel
  fires `{canceled: true}`, selection returns the array of
  `{uri, name, size, mimeType}` assets.
- **expo-image-picker:** `pick image` uses the same dialog with
  `image/*` filters; `snap from camera` skips the dialog and
  fires the existing GStreamer cameraSnap. The chosen / captured
  image renders inline via `<Image>`.

## API surface (combined)

### expo-document-picker

| API                                  | Behavior on Linux                                     |
| ------------------------------------ | ----------------------------------------------------- |
| `getDocumentAsync({type, multiple})` | Real — GtkFileDialog with the given MIME filter       |
| `result.canceled`                    | `true` on user dismissal (GTK_DIALOG_ERROR_DISMISSED) |
| `result.assets[]`                    | `{uri (file://), name, size, mimeType}` per selection |
| `options.copyToCacheDirectory`       | Accepted, discarded — original path is returned       |

### expo-image-picker

| API                                                              | Behavior on Linux                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `launchImageLibraryAsync({mediaTypes, allowsMultipleSelection})` | GtkFileDialog with image/_ / video/_ filter                      |
| `launchCameraAsync()`                                            | Chains into `rnLinux.cameraSnap` (videotestsrc or v4l2src → PNG) |
| `MediaTypeOptions` / `MediaType`                                 | Both legacy string + v15+ array forms accepted                   |
| `get/requestCameraPermissionsAsync`                              | Always `granted` — Linux gates at the device + filesystem layer  |
| `get/requestMediaLibraryPermissionsAsync`                        | Always `granted`                                                 |
| `getPendingResultAsync()`                                        | Returns `[]` — Android-only "killed-during-pick" recovery hook   |
| `CameraType / ImagePickerOrderBy / VideoExportPreset / …` enums  | Exported for cross-platform branch parity                        |

## Known gaps

- **No image cropping / editing UI.** Upstream's `allowsEditing`
  option pops a native crop dialog on iOS/Android; GTK has no
  equivalent. Apps would build their own crop UI in JS or skip
  the feature on Linux.
- **No width / height / duration extraction.** Returned assets
  have `width=null, height=null, duration=null` since reading
  those would need image/video decoding per file (libsoup +
  gdk-pixbuf for images, gstreamer for video). The caller can
  load the URI via `<Image>` and read measured dimensions if
  they need them.
- **`launchCameraAsync` is one-shot photo only.** Video capture
  (`mediaTypes: Videos`) isn't wired through to a video-recording
  pipeline. The existing cameraSnap produces a single PNG; full
  video would need an x264enc / mp4mux pipeline (see the
  expo-camera doc's "Video recording" gap).
- **No `copyToCacheDirectory` honoring.** Upstream copies the
  selected file to the app's cache so the original can't be
  modified out from under you. We return the original path; the
  caller can use `expo-file-system.copyAsync` if they need the
  same isolation.
