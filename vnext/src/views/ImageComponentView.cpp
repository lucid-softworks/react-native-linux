#include "ImageComponentView.h"

#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <react/renderer/components/image/ImageProps.h>
#include <react/renderer/imagemanager/primitives.h>

// libsoup-3 is optional at build time (HAVE_LIBSOUP3 is defined by
// the CMake config when pkg-config found it). When absent we still
// accept http(s) URIs but warn and render nothing.
#if __has_include(<libsoup/soup.h>)
#include <libsoup/soup.h>
#define RNL_HAVE_LIBSOUP3 1
#endif

#include <atomic>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <glib/gstdio.h>

namespace {

// File extensions that mean "could be animated" and warrant the
// GtkMediaFile path. GtkMediaFile is GTK4's general video/audio
// playback widget; for animated GIF/WebP/APNG it just renders the
// frames on a GStreamer-backed loop, which is fine even for small
// images. Static formats stay on the GdkTexture path for the
// lower-latency one-shot decode.
bool isAnimatedExtension(const std::string& path) {
  auto lower = [](std::string s) {
    for (auto& c : s)
      c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
  };
  const auto dot = path.find_last_of('.');
  if (dot == std::string::npos)
    return false;
  const std::string ext = lower(path.substr(dot));
  return ext == ".gif" || ext == ".webp" || ext == ".apng";
}

} // namespace

namespace rnlinux {

namespace {

// Strip file:// from a URI. Returns empty for any non-file scheme so
// the caller can decide how to handle remote URIs.
std::string fileSchemePath(const std::string& uri) {
  constexpr const char* kPrefix = "file://";
  const auto plen = std::strlen(kPrefix);
  if (uri.compare(0, plen, kPrefix) == 0) {
    return uri.substr(plen);
  }
  return {};
}

bool isHttpScheme(const std::string& uri) {
  return uri.rfind("http://", 0) == 0 || uri.rfind("https://", 0) == 0;
}

#ifdef RNL_HAVE_LIBSOUP3
// Process-wide SoupCache anchored under XDG_CACHE_HOME — clearable
// from JS via `Image.clearDiskCache`. Kept as a separate global so
// the JSI binding can reach in without owning the session.
SoupCache* sharedCache() {
  static SoupCache* c = nullptr;
  if (c)
    return c;
  std::string dir = rnlinux::imageCacheDir();
  g_mkdir_with_parents(dir.c_str(), 0700);
  // SOUP_CACHE_SINGLE_USER means we don't bother stripping cookies /
  // auth on store — fine because the app's HTTP fetches are anon.
  // libsoup-3 split the max-size knob out into its own setter; 64 MiB
  // is enough for tens of thousands of typical image responses and
  // small enough not to surprise users on disk-constrained boxes.
  c = soup_cache_new(dir.c_str(), SOUP_CACHE_SINGLE_USER);
  if (c)
    soup_cache_set_max_size(c, 64 * 1024 * 1024);
  return c;
}

// One process-wide SoupSession — sessions are thread-safe and reusing
// one gets HTTP keep-alive across image loads. We attach the cache
// here so all image fetches go through it transparently.
SoupSession* sharedSession() {
  static SoupSession* s = []() {
    SoupSession* sess = soup_session_new();
    SoupCache* cache = sharedCache();
    if (cache) {
      soup_session_add_feature(sess, SOUP_SESSION_FEATURE(cache));
      // Load whatever's on disk from a previous run — without this
      // every cold-start fetch misses the cache.
      soup_cache_load(cache);
    }
    return sess;
  }();
  return s;
}

struct ImageFetch {
  GtkPicture* picture;
  std::string uri;
};

void onImageBytes(GObject* source, GAsyncResult* result, gpointer user) {
  auto* fetch = static_cast<ImageFetch*>(user);
  GError* err = nullptr;
  GBytes* bytes = soup_session_send_and_read_finish(SOUP_SESSION(source), result, &err);
  if (!bytes) {
    RNL_LOGW("Image") << "http fetch failed for " << fetch->uri << ": "
                      << (err ? err->message : "(unknown)");
    if (err)
      g_error_free(err);
    delete fetch;
    return;
  }
  // Skip if the widget moved on to a different uri while we waited.
  const char* current =
      static_cast<const char*>(g_object_get_data(G_OBJECT(fetch->picture), "rnl-current-uri"));
  if (!current || fetch->uri != current) {
    g_bytes_unref(bytes);
    delete fetch;
    return;
  }
  // Animated formats — write the bytes to a temp file and hand
  // GtkMediaFile the file URI so its GStreamer pipeline can loop
  // the frames. gdk_texture_new_from_bytes can decode any image
  // format gdk-pixbuf knows about but it only returns the FIRST
  // frame, so static use of it for an animated GIF/WebP would
  // freeze the image on frame 0.
  if (isAnimatedExtension(fetch->uri)) {
    gsize len = 0;
    const void* data = g_bytes_get_data(bytes, &len);
    std::string dir = rnlinux::imageCacheDir() + "/anim";
    g_mkdir_with_parents(dir.c_str(), 0700);
    // Filename includes a per-request suffix so concurrent loads
    // of the same uri don't stomp each other.
    static std::atomic<int64_t> animSeq{1};
    char tmpName[128];
    std::snprintf(tmpName,
                  sizeof(tmpName),
                  "%s/http-%lld-%ld.bin",
                  dir.c_str(),
                  (long long)animSeq.fetch_add(1),
                  (long)time(nullptr));
    GError* writeErr = nullptr;
    g_file_set_contents(tmpName, static_cast<const char*>(data), len, &writeErr);
    g_bytes_unref(bytes);
    if (writeErr) {
      RNL_LOGW("Image") << "animated cache write failed: " << writeErr->message;
      g_error_free(writeErr);
      delete fetch;
      return;
    }
    GFile* gfile = g_file_new_for_path(tmpName);
    GtkMediaStream* stream = GTK_MEDIA_STREAM(gtk_media_file_new_for_file(gfile));
    g_object_unref(gfile);
    if (stream) {
      gtk_media_stream_set_loop(stream, TRUE);
      gtk_media_stream_set_muted(stream, TRUE);
      gtk_media_stream_play(stream);
      gtk_picture_set_paintable(fetch->picture, GDK_PAINTABLE(stream));
      g_object_unref(stream);
    }
    delete fetch;
    return;
  }
  GError* texErr = nullptr;
  GdkTexture* tex = gdk_texture_new_from_bytes(bytes, &texErr);
  g_bytes_unref(bytes);
  if (!tex) {
    RNL_LOGW("Image") << "decode failed for " << fetch->uri << ": "
                      << (texErr ? texErr->message : "(unknown)");
    if (texErr)
      g_error_free(texErr);
    delete fetch;
    return;
  }
  gtk_picture_set_paintable(fetch->picture, GDK_PAINTABLE(tex));
  g_object_unref(tex);
  delete fetch;
}

void startHttpFetch(GtkPicture* picture, const std::string& uri) {
  // Stash the in-flight uri so the callback can detect supersession.
  g_object_set_data_full(G_OBJECT(picture), "rnl-current-uri", g_strdup(uri.c_str()), g_free);
  SoupMessage* msg = soup_message_new(SOUP_METHOD_GET, uri.c_str());
  if (!msg) {
    RNL_LOGW("Image") << "bad uri: " << uri;
    return;
  }
  // Many image hosts (Wikipedia / Wikimedia, GitHub raw, some CDNs)
  // reject requests with no User-Agent — Wikipedia answers HTTP
  // 400 outright. libsoup leaves the header empty unless we set
  // it, so identify ourselves with a stable string that includes
  // the libsoup version so server logs can attribute issues
  // upstream if we ever cause one.
  SoupMessageHeaders* hdrs = soup_message_get_request_headers(msg);
  if (hdrs) {
    soup_message_headers_replace(hdrs, "User-Agent", "react-native-linux libsoup/3");
    // Accept any image type — some servers do strict content
    // negotiation and would 406 if we leave Accept empty.
    soup_message_headers_replace(hdrs, "Accept", "image/*,*/*;q=0.8");
  }
  auto* fetch = new ImageFetch{picture, uri};
  soup_session_send_and_read_async(
      sharedSession(), msg, G_PRIORITY_DEFAULT, nullptr, onImageBytes, fetch);
  g_object_unref(msg);
}
#endif // RNL_HAVE_LIBSOUP3

GtkContentFit toContentFit(facebook::react::ImageResizeMode mode) {
  switch (mode) {
  case facebook::react::ImageResizeMode::Cover:
    return GTK_CONTENT_FIT_COVER;
  case facebook::react::ImageResizeMode::Contain:
    return GTK_CONTENT_FIT_CONTAIN;
  case facebook::react::ImageResizeMode::Stretch:
    return GTK_CONTENT_FIT_FILL;
  case facebook::react::ImageResizeMode::Center:
    return GTK_CONTENT_FIT_SCALE_DOWN;
  case facebook::react::ImageResizeMode::Repeat:
    return GTK_CONTENT_FIT_FILL;
  }
  return GTK_CONTENT_FIT_CONTAIN;
}

} // namespace

ImageComponentView::ImageComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_picture_new();
  takeWidgetRef();
  // GtkPicture defaults to expand=TRUE which lets it grow into its
  // allocation — we want it to fill whatever frame Yoga gives us.
  gtk_widget_set_hexpand(widget_, TRUE);
  gtk_widget_set_vexpand(widget_, TRUE);
  // CAN_SHRINK lets the image scale down inside small bounds; without
  // it GtkPicture insists on natural size and the parent gets pushed.
  gtk_picture_set_can_shrink(GTK_PICTURE(widget_), TRUE);
}

ImageComponentView::~ImageComponentView() = default;

void ImageComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                     facebook::react::Props const& newProps) {
  const auto& ip = static_cast<const facebook::react::ImageProps&>(newProps);

  // resizeMode is independent of source loading; apply on every pass.
  gtk_picture_set_content_fit(GTK_PICTURE(widget_), toContentFit(ip.resizeMode));

  if (ip.sources.empty()) {
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
    currentUri_.clear();
    return;
  }

  const auto& uri = ip.sources.front().uri;
  if (uri == currentUri_) {
    // Same source we already loaded; nothing to do (resizeMode handled
    // above).
    return;
  }
  currentUri_ = uri;

  // file:// loads synchronously via GdkTexture; http(s) goes through
  // libsoup's async fetch (when the build linked it).
  if (isHttpScheme(uri)) {
#ifdef RNL_HAVE_LIBSOUP3
    // Clear the current paintable so the box stays empty until the
    // async load lands. The fetch callback drops in the texture.
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
    startHttpFetch(GTK_PICTURE(widget_), uri);
#else
    RNL_LOGW("Image") << "http uri but libsoup3 wasn't linked: " << uri;
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
#endif
    return;
  }

  const auto path = fileSchemePath(uri);
  if (path.empty()) {
    RNL_LOGW("Image") << "unsupported uri scheme (tag=" << tag_ << "): " << uri;
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
    return;
  }

  // Animated formats (GIF / WebP / APNG) — route through
  // GtkMediaFile. It owns the GStreamer pipeline that decodes
  // frames in real time, loops the stream, and exposes the result
  // as a GdkPaintable so GtkPicture can render it the same way
  // it does any other paintable. Static formats stay on the
  // GdkTexture fast path below.
  if (isAnimatedExtension(path)) {
    GFile* gfile = g_file_new_for_path(path.c_str());
    GtkMediaStream* stream = GTK_MEDIA_STREAM(gtk_media_file_new_for_file(gfile));
    g_object_unref(gfile);
    if (stream) {
      gtk_media_stream_set_loop(stream, TRUE);
      gtk_media_stream_set_muted(stream, TRUE);
      gtk_media_stream_play(stream);
      gtk_picture_set_paintable(GTK_PICTURE(widget_), GDK_PAINTABLE(stream));
      g_object_unref(stream);
      return;
    }
    // Fall through to the static-decode path if GtkMediaFile didn't
    // materialize a stream (very old GTK4 or missing GStreamer
    // plugins). The first frame will at least render.
  }

  GFile* gfile = g_file_new_for_path(path.c_str());
  GError* err = nullptr;
  GdkTexture* tex = gdk_texture_new_from_file(gfile, &err);
  g_object_unref(gfile);
  if (!tex) {
    RNL_LOGW("Image") << "load failed (tag=" << tag_ << "): " << (err ? err->message : "(unknown)");
    if (err)
      g_error_free(err);
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
    return;
  }
  gtk_picture_set_paintable(GTK_PICTURE(widget_), GDK_PAINTABLE(tex));
  g_object_unref(tex);
}

// ─── Cache helpers (exported via the JSI bindings) ────────────────

std::string imageCacheDir() {
  // XDG_CACHE_HOME with the standard ~/.cache fallback. We keep the
  // image cache under a named subdir rather than libsoup's default
  // so a clear here doesn't wipe other consumers' libsoup caches.
  std::string base;
  if (const char* c = std::getenv("XDG_CACHE_HOME"); c && *c) {
    base = c;
  } else if (const char* h = std::getenv("HOME"); h && *h) {
    base = std::string(h) + "/.cache";
  } else {
    base = "/tmp";
  }
  return base + "/rn-linux-playground/soup-image-cache";
}

void clearImageCache() {
#ifdef RNL_HAVE_LIBSOUP3
  // Drain the live cache first so in-flight responses don't repopulate
  // the directory between our call and the unlink. soup_cache_clear
  // does both memory and on-disk entries under SOUP_CACHE_SINGLE_USER.
  if (SoupCache* cache = sharedCache()) {
    soup_cache_clear(cache);
    soup_cache_flush(cache);
  }
#endif
  // Belt-and-braces: also remove anything lingering on disk in case
  // the cache wasn't initialized (e.g. no http loads happened yet
  // this session) or a prior version of the app left orphan files.
  const std::string dir = imageCacheDir();
  GDir* d = g_dir_open(dir.c_str(), 0, nullptr);
  if (!d)
    return;
  const char* name;
  while ((name = g_dir_read_name(d))) {
    std::string p = dir + "/" + name;
    // Cache files are flat — no need to recurse.
    g_unlink(p.c_str());
  }
  g_dir_close(d);
}

} // namespace rnlinux
