#pragma once

// GStreamer-backed camera pipeline for `expo-camera`. Two surfaces:
//
//  * `Preview` — a long-lived pipeline that streams RGBA frames into a
//    GtkPicture via GdkMemoryTexture. The Fabric CameraView owns one
//    of these per mounted <CameraView>.
//  * `snap()` — a one-shot capture that writes a PNG to a temp file
//    and fires a callback. Runs in its own short pipeline so it
//    doesn't disturb any active previews.
//
// Source selection: if /dev/video0 exists we open it via `v4l2src`;
// otherwise we fall back to `videotestsrc` so the Lima dev VM (no
// camera) still shows a working pipeline (SMPTE-style test pattern).

#include <atomic>
#include <cstdint>
#include <functional>
#include <gst/gst.h>
#include <gtk/gtk.h>
#include <memory>
#include <string>

namespace rnlinux::camera {

// True if any /dev/video* node exists. Used by JS / probes to know
// whether we'll get test pattern or real frames.
bool hasV4l2Device();

// Result handed back to JS for takePictureAsync. `uri` is a file://
// URL so the RN Image component can load it directly via libsoup.
struct SnapResult {
  std::string uri;
  int width = 0;
  int height = 0;
};

using SnapCallback = std::function<void(const SnapResult&)>;
using SnapErrorCallback = std::function<void(const std::string&)>;

// Run one capture from videotestsrc/v4l2src → pngenc → file. Callback
// fires on the main loop thread once the pipeline reaches EOS or
// errors. Non-blocking: returns immediately after kicking off the
// pipeline.
void snap(SnapCallback onResult, SnapErrorCallback onError);

// Long-lived preview tied to a single GtkPicture. Constructing one
// builds the pipeline and starts playing; destroying it stops and
// unrefs. Frames are decoded to RGBA8 on the streaming thread, then
// dispatched to the main thread to be wrapped in a GdkMemoryTexture
// and set on `picture` via gtk_picture_set_paintable.
class Preview {
 public:
  // `picture` must outlive `*this`. The Fabric ComponentView keeps a
  // ref via takeWidgetRef so this holds by raw pointer.
  explicit Preview(GtkPicture* picture);
  ~Preview();
  Preview(const Preview&) = delete;
  Preview& operator=(const Preview&) = delete;

  // Drop the pipeline early without waiting for the destructor.
  // Idempotent; safe to call multiple times.
  void stop();

 private:
  static GstFlowReturn onNewSample(GstElement* appsink, gpointer userData);

  GtkPicture* picture_;
  GstElement* pipeline_ = nullptr;
  GstElement* appsink_ = nullptr;
  std::atomic<bool> stopped_{false};
};

} // namespace rnlinux::camera
