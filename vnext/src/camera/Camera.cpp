#include "Camera.h"

#include "react-native-linux/Logging.h"

#include <atomic>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <dirent.h>
#include <fstream>
#include <gst/app/gstappsink.h>
#include <gst/gst.h>
#include <gst/video/video-info.h>
#include <mutex>
#include <sys/stat.h>
#include <unistd.h>

namespace rnlinux::camera {

namespace {

// One-time GStreamer init. Safe to call from multiple TUs; gst_init
// is idempotent (it tracks a refcount internally).
void ensureGstInit() {
  static std::once_flag flag;
  std::call_once(flag, []() {
    GError* err = nullptr;
    if (!gst_init_check(nullptr, nullptr, &err)) {
      RNL_LOGE("rnLinux.camera") << "gst_init_check failed: "
                                 << (err && err->message ? err->message : "(unknown)");
      if (err)
        g_error_free(err);
    } else {
      RNL_LOGI("rnLinux.camera") << "GStreamer initialized (" << gst_version_string() << ")";
    }
  });
}

constexpr const char* kV4l2Device = "/dev/video0";

// We default to videotestsrc when no /dev/video* exists so dev VMs
// still show a real pipeline. Pattern "smpte" is the classic colour
// bars — visually unmistakable as "this is the test source", which
// is what you want for a CameraView fallback demo.
std::string sourcePart() {
  if (hasV4l2Device())
    return std::string("v4l2src device=") + kV4l2Device;
  return "videotestsrc is-live=true pattern=smpte";
}

// Find a writable spot for snap output. XDG_CACHE_HOME ?? ~/.cache.
std::string snapPath() {
  const char* cache = std::getenv("XDG_CACHE_HOME");
  std::string dir;
  if (cache && *cache) {
    dir = cache;
  } else if (const char* home = std::getenv("HOME")) {
    dir = std::string(home) + "/.cache";
  } else {
    dir = "/tmp";
  }
  dir += "/rn-linux";
  mkdir(dir.c_str(), 0700);
  char buf[64];
  std::snprintf(buf, sizeof(buf), "/snap-%ld-%d.png", (long)time(nullptr), (int)getpid());
  return dir + buf;
}

} // namespace

bool hasV4l2Device() {
  struct stat st;
  return stat(kV4l2Device, &st) == 0;
}

int v4l2CaptureDeviceCount() {
  // /sys/class/video4linux/ has one symlink per V4L2 device node, with
  // a `name` attribute the kernel populates from the driver. We use
  // that to skip metadata-only nodes (vbi, radio, swradio share the
  // namespace but aren't capture devices). Cheap — sysfs reads only,
  // no device opens or VIDIOC ioctls.
  DIR* d = opendir("/sys/class/video4linux");
  if (!d)
    return 0;
  int count = 0;
  struct dirent* ent;
  while ((ent = readdir(d))) {
    const std::string name = ent->d_name;
    if (name == "." || name == "..")
      continue;
    // The entry name itself encodes the device type: video* are
    // capture/output, vbi* are vertical-blank, radio* are tuners,
    // swradio* are software-defined-radio. Only video* are camera-like.
    if (name.rfind("video", 0) != 0)
      continue;
    // A few drivers (e.g. v4l2-loopback) and some encoder/decoder
    // hardware (Intel VAAPI, etc.) expose video* nodes that aren't
    // capture. Filter those out by reading the device name: anything
    // with "decoder"/"encoder"/"output" in it is not what we want.
    std::ifstream f("/sys/class/video4linux/" + name + "/name");
    std::string devName;
    if (f.is_open())
      std::getline(f, devName);
    auto contains = [&devName](const char* needle) {
      return devName.find(needle) != std::string::npos;
    };
    if (contains("decoder") || contains("encoder") || contains("output"))
      continue;
    ++count;
  }
  closedir(d);
  return count;
}

// ─── snap (one-shot capture) ──────────────────────────────────────

namespace {

struct SnapCtx {
  GstElement* pipeline = nullptr;
  guint busWatchId = 0;
  std::string outPath;
  int width = 640;
  int height = 480;
  SnapCallback onResult;
  SnapErrorCallback onError;
};

void finishSnap(SnapCtx* ctx, bool ok, const std::string& errMsg) {
  if (!ctx)
    return;
  if (ctx->pipeline) {
    gst_element_set_state(ctx->pipeline, GST_STATE_NULL);
  }
  if (ctx->busWatchId)
    g_source_remove(ctx->busWatchId);
  if (ok) {
    if (ctx->onResult) {
      SnapResult r;
      r.uri = "file://" + ctx->outPath;
      r.width = ctx->width;
      r.height = ctx->height;
      ctx->onResult(r);
    }
  } else {
    if (ctx->onError)
      ctx->onError(errMsg);
  }
  if (ctx->pipeline) {
    gst_object_unref(ctx->pipeline);
    ctx->pipeline = nullptr;
  }
  delete ctx;
}

gboolean onSnapBus(GstBus* /*bus*/, GstMessage* msg, gpointer userData) {
  auto* ctx = static_cast<SnapCtx*>(userData);
  switch (GST_MESSAGE_TYPE(msg)) {
  case GST_MESSAGE_EOS:
    finishSnap(ctx, true, {});
    return G_SOURCE_REMOVE;
  case GST_MESSAGE_ERROR: {
    GError* err = nullptr;
    gchar* dbg = nullptr;
    gst_message_parse_error(msg, &err, &dbg);
    std::string m = err && err->message ? err->message : "snap pipeline error";
    if (err)
      g_error_free(err);
    g_free(dbg);
    finishSnap(ctx, false, m);
    return G_SOURCE_REMOVE;
  }
  default:
    return G_SOURCE_CONTINUE;
  }
}

} // namespace

void snap(SnapCallback onResult, SnapErrorCallback onError) {
  ensureGstInit();

  auto* ctx = new SnapCtx{};
  ctx->onResult = std::move(onResult);
  ctx->onError = std::move(onError);
  ctx->outPath = snapPath();

  // Single-buffer pipeline: source → convert → png → file. num-buffers=1
  // tells GStreamer "after one frame, EOS". pngenc + filesink land the
  // bytes; the bus watch fires EOS once the file is fully written.
  std::string desc = std::string(sourcePart()) +
                     " num-buffers=1 ! videoconvert ! videoscale ! "
                     "video/x-raw,width=" +
                     std::to_string(ctx->width) + ",height=" + std::to_string(ctx->height) +
                     " ! pngenc ! filesink location=\"" + ctx->outPath + "\"";

  GError* parseErr = nullptr;
  ctx->pipeline = gst_parse_launch(desc.c_str(), &parseErr);
  if (!ctx->pipeline) {
    std::string m = parseErr && parseErr->message ? parseErr->message : "gst_parse_launch failed";
    if (parseErr)
      g_error_free(parseErr);
    finishSnap(ctx, false, m);
    return;
  }
  if (parseErr)
    g_error_free(parseErr);

  GstBus* bus = gst_element_get_bus(ctx->pipeline);
  ctx->busWatchId = gst_bus_add_watch(bus, onSnapBus, ctx);
  gst_object_unref(bus);

  if (gst_element_set_state(ctx->pipeline, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
    finishSnap(ctx, false, "could not start snap pipeline");
  }
}

// ─── Preview (live frames into a GtkPicture) ──────────────────────

namespace {

// We can't hold a raw Preview* across the streaming → main thread
// hop — the React reconciler may unmount <CameraView> in between,
// destroying *this Preview before the idle source fires. Pin the
// GtkPicture directly via g_object_ref so the dispatcher works
// against a stable object whose lifetime is GTK-managed.
struct FrameDelivery {
  GtkPicture* picture; // strong ref held; unref'd in deliverOnMain
  GBytes* bytes;
  int width;
  int height;
  int stride;
};

gboolean deliverOnMain(gpointer userData) {
  auto* d = static_cast<FrameDelivery*>(userData);
  if (d->picture && GTK_IS_PICTURE(d->picture)) {
    GdkTexture* tex = GDK_TEXTURE(gdk_memory_texture_new(
        d->width, d->height, GDK_MEMORY_R8G8B8A8, d->bytes, static_cast<gsize>(d->stride)));
    gtk_picture_set_paintable(d->picture, GDK_PAINTABLE(tex));
    g_object_unref(tex);
  }
  if (d->picture)
    g_object_unref(d->picture);
  g_bytes_unref(d->bytes);
  delete d;
  return G_SOURCE_REMOVE;
}

} // namespace

Preview::Preview(GtkPicture* picture)
    : picture_(picture) {
  ensureGstInit();

  // Caps: RGBA so the output buffer is GdkMemoryTexture-ready
  // (GDK_MEMORY_R8G8B8A8). Throttle to 15fps in software-rendered
  // VMs so the JS thread doesn't spend every cycle reuploading
  // textures.
  std::string desc = std::string(sourcePart()) +
                     " ! videoconvert ! videoscale ! videorate ! "
                     "video/x-raw,format=RGBA,width=320,height=240,framerate=15/1 ! "
                     "appsink name=sink emit-signals=true max-buffers=1 drop=true sync=false";

  GError* parseErr = nullptr;
  pipeline_ = gst_parse_launch(desc.c_str(), &parseErr);
  if (!pipeline_) {
    RNL_LOGE("rnLinux.camera") << "preview gst_parse_launch failed: "
                               << (parseErr && parseErr->message ? parseErr->message : "?");
    if (parseErr)
      g_error_free(parseErr);
    return;
  }
  if (parseErr)
    g_error_free(parseErr);

  appsink_ = gst_bin_get_by_name(GST_BIN(pipeline_), "sink");
  if (!appsink_) {
    RNL_LOGE("rnLinux.camera") << "preview appsink not found";
    gst_element_set_state(pipeline_, GST_STATE_NULL);
    gst_object_unref(pipeline_);
    pipeline_ = nullptr;
    return;
  }
  g_object_set(appsink_, "emit-signals", TRUE, nullptr);
  g_signal_connect(appsink_, "new-sample", G_CALLBACK(&Preview::onNewSample), this);

  if (gst_element_set_state(pipeline_, GST_STATE_PLAYING) == GST_STATE_CHANGE_FAILURE) {
    RNL_LOGE("rnLinux.camera") << "preview failed to start";
  }
}

Preview::~Preview() {
  stop();
}

void Preview::stop() {
  if (stopped_.exchange(true))
    return;
  if (pipeline_) {
    gst_element_set_state(pipeline_, GST_STATE_NULL);
  }
  if (appsink_) {
    gst_object_unref(appsink_);
    appsink_ = nullptr;
  }
  if (pipeline_) {
    gst_object_unref(pipeline_);
    pipeline_ = nullptr;
  }
}

GstFlowReturn Preview::onNewSample(GstElement* appsink, gpointer userData) {
  auto* self = static_cast<Preview*>(userData);
  if (self->stopped_.load())
    return GST_FLOW_FLUSHING;

  GstSample* sample = gst_app_sink_pull_sample(GST_APP_SINK(appsink));
  if (!sample)
    return GST_FLOW_ERROR;

  GstCaps* caps = gst_sample_get_caps(sample);
  GstVideoInfo info;
  if (!gst_video_info_from_caps(&info, caps)) {
    gst_sample_unref(sample);
    return GST_FLOW_ERROR;
  }

  GstBuffer* buf = gst_sample_get_buffer(sample);
  GstMapInfo map;
  if (!gst_buffer_map(buf, &map, GST_MAP_READ)) {
    gst_sample_unref(sample);
    return GST_FLOW_ERROR;
  }

  // Copy the pixel data into a GBytes owned by GLib — the sample +
  // buffer + map all unwind on this thread before the main thread
  // re-runs, so we can't hand the original buffer over directly.
  const int width = GST_VIDEO_INFO_WIDTH(&info);
  const int height = GST_VIDEO_INFO_HEIGHT(&info);
  const int stride = GST_VIDEO_INFO_PLANE_STRIDE(&info, 0);
  // Tightly bound the GBytes to the pixel region: gst buffers can
  // carry padding past height*stride, and GdkMemoryTexture stops
  // reading at byteSize/stride rows. If byteSize is bigger than
  // expected it doesn't trip; if smaller, we'd silently truncate.
  const gsize byteSize = static_cast<gsize>(stride) * static_cast<gsize>(height);
  GBytes* bytes = g_bytes_new(map.data, byteSize);
  gst_buffer_unmap(buf, &map);
  gst_sample_unref(sample);

  GtkPicture* pic = self->picture_;
  if (pic)
    g_object_ref(pic);
  auto* d = new FrameDelivery{pic, bytes, width, height, stride};
  g_idle_add(deliverOnMain, d);

  return GST_FLOW_OK;
}

} // namespace rnlinux::camera
