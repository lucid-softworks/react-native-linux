#include "ImageComponentView.h"

#include "TintedPaintable.h"
#include "react-native-linux/AppContext.h"
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
#include <thread>

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

// Decode the base64 payload of a data: URI into a freshly-owned
// GdkPixbuf. Caller takes ownership and unrefs.
// Runs the gdk_pixbuf_loader write + close cycle which is CPU-bound
// and gives meaningful latency on > 16 KB payloads (50 ms+ for full-
// page splash images, even sub-MB hero shots).
GdkPixbuf* decodeDataUriPayload(const std::string& payload) {
  gsize binLen = 0;
  guchar* bin = g_base64_decode(payload.c_str(), &binLen);
  if (!bin || binLen == 0) {
    if (bin)
      g_free(bin);
    return nullptr;
  }
  GdkPixbufLoader* loader = gdk_pixbuf_loader_new();
  GError* err = nullptr;
  GdkPixbuf* pixbuf = nullptr;
  if (gdk_pixbuf_loader_write(loader, bin, binLen, &err) && gdk_pixbuf_loader_close(loader, &err)) {
    GdkPixbuf* raw = gdk_pixbuf_loader_get_pixbuf(loader);
    if (raw) {
      // get_pixbuf returns a borrowed ref tied to the loader; ref so
      // we can outlive the g_object_unref(loader) below.
      pixbuf = static_cast<GdkPixbuf*>(g_object_ref(raw));
    }
  }
  if (err) {
    RNL_LOGW("Image") << "data: decode failed: " << err->message;
    g_error_free(err);
  }
  g_object_unref(loader);
  g_free(bin);
  return pixbuf;
}

// data:[<mime>][;base64],<payload>
// esbuild's `loader: 'dataurl'` rewrites bundled image assets into this
// form, so akari's AppLogo (a 4 kB PNG) lands here at import time. We
// decode + feed GdkPixbufLoader, then hand the pixbuf to GdkTexture
// for GtkPicture. base64 is what RN's image asset registry emits in
// practice; uri-encoded payloads are rare enough we don't decode them
// today.
//
// Returns nullptr (and leaves payload empty) if the URI isn't a
// recognized base64-encoded data URI. On success, `payload` holds the
// payload string ready to feed `decodeDataUriPayload`.
bool extractDataUriPayload(const std::string& uri, std::string& payload) {
  // Parse "data:<mime>;base64,<payload>" — the comma after the
  // type/encoding metadata is the delimiter.
  const auto comma = uri.find(',');
  if (comma == std::string::npos)
    return false;
  const std::string head = uri.substr(5, comma - 5); // skip "data:"
  if (head.find("base64") == std::string::npos)
    return false;
  payload = uri.substr(comma + 1);
  return true;
}

// Forward declaration — applyPaintable lives further down so it can
// reach the tinted-paintable qdata helper that's defined alongside
// the SoupSession setup. The async-decode completion below needs it
// to wrap the freshly-loaded texture in the same tint wrapper any
// sync apply would.
void applyPaintable(GtkPicture* picture, GdkPaintable* raw);

// Payload size above which we route the decode to a worker thread.
// 16 KB is the typical edge between "icons / splash logos" (sub-ms
// decode, drop-through path) and "real images" (50 ms+, blocks the
// mount commit chain). Base64 inflates by ~33 %, so 16 KB of payload
// ≈ 12 KB of raw image data.
constexpr gsize kDataUriAsyncThreshold = 16 * 1024;

// Heap-allocated context handed from the decode worker back to the
// main-thread completion callback. We ref the GtkPicture so it stays
// alive through the decode; the completion checks the current-uri
// qdata to skip apply if updateProps moved on to a different source.
struct DataUriDecode {
  GtkPicture* picture; // ref held
  std::string uri;
  GdkPixbuf* pixbuf; // set by worker, consumed by main
};

gboolean onDataUriDecodeFinish(gpointer userData) {
  auto* ctx = static_cast<DataUriDecode*>(userData);
  // Supersession check — applyPaintable would otherwise stomp a
  // newer source the view moved on to during the decode.
  const char* current =
      static_cast<const char*>(g_object_get_data(G_OBJECT(ctx->picture), "rnl-current-uri"));
  bool stillCurrent = current && ctx->uri == current;
  if (stillCurrent && ctx->pixbuf) {
    GdkTexture* texture = gdk_texture_new_for_pixbuf(ctx->pixbuf);
    if (texture) {
      applyPaintable(ctx->picture, GDK_PAINTABLE(texture));
      g_object_unref(texture);
    }
  }
  if (ctx->pixbuf)
    g_object_unref(ctx->pixbuf);
  g_object_unref(ctx->picture);
  delete ctx;
  return G_SOURCE_REMOVE;
}

// Spawn a detached thread that decodes the data URI, then hand the
// result back to the GTK main loop for paintable application.
void startDataUriDecodeAsync(GtkPicture* picture, std::string uri, std::string payload) {
  auto* ctx = new DataUriDecode{
      static_cast<GtkPicture*>(g_object_ref(picture)),
      std::move(uri),
      nullptr,
  };
  std::thread([ctx, payload = std::move(payload)]() {
    ctx->pixbuf = decodeDataUriPayload(payload);
    g_idle_add_full(G_PRIORITY_HIGH_IDLE, onDataUriDecodeFinish, ctx, nullptr);
  }).detach();
}

// Tint colour qdata key on the GtkPicture. The async fetch callbacks
// don't carry an ImageComponentView pointer (the view can be unmounted
// before the request lands), so we stash the desired tint on the
// widget itself; `applyPaintable` reads it back when wiring the final
// paintable so the wrapper is applied uniformly across file://, data:,
// and http(s) load paths.
constexpr const char* kTintKey = "rnl-tint-color";

void setPictureTint(GtkPicture* picture, const std::optional<GdkRGBA>& tint) {
  if (tint) {
    GdkRGBA* heap = g_new(GdkRGBA, 1);
    *heap = *tint;
    g_object_set_data_full(G_OBJECT(picture), kTintKey, heap, g_free);
  } else {
    g_object_set_data(G_OBJECT(picture), kTintKey, nullptr);
  }
}

const GdkRGBA* getPictureTint(GtkPicture* picture) {
  return static_cast<const GdkRGBA*>(g_object_get_data(G_OBJECT(picture), kTintKey));
}

// Set `raw` as the picture's paintable, wrapping it in a tinted
// paintable when a tint colour is stashed on the widget. Passing
// `nullptr` clears the picture either way.
void applyPaintable(GtkPicture* picture, GdkPaintable* raw) {
  const GdkRGBA* tint = getPictureTint(picture);
  if (raw && tint) {
    GdkPaintable* wrapped = rn_linux_tinted_paintable_new(raw, tint);
    gtk_picture_set_paintable(picture, wrapped);
    g_object_unref(wrapped);
  } else {
    gtk_picture_set_paintable(picture, raw);
  }
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
      applyPaintable(fetch->picture, GDK_PAINTABLE(stream));
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
  applyPaintable(fetch->picture, GDK_PAINTABLE(tex));
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

  // Translate ImageProps' SharedColor tint into a GdkRGBA, mirroring
  // ViewComponentView's 0xAARRGGBB unpacking. An unset color reads
  // as falsy and clears any prior tint.
  std::optional<GdkRGBA> nextTint;
  if (ip.tintColor) {
    const auto v = static_cast<unsigned int>(*ip.tintColor);
    nextTint = GdkRGBA{
        ((v >> 16) & 0xff) / 255.0f,
        ((v >> 8) & 0xff) / 255.0f,
        (v & 0xff) / 255.0f,
        ((v >> 24) & 0xff) / 255.0f,
    };
  }
  const bool tintChanged = tint_.has_value() != nextTint.has_value() ||
                           (tint_ && nextTint && !gdk_rgba_equal(&*tint_, &*nextTint));
  tint_ = nextTint;
  setPictureTint(GTK_PICTURE(widget_), tint_);

  if (ip.sources.empty()) {
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
    currentUri_.clear();
    return;
  }

  const auto& uri = ip.sources.front().uri;
  if (uri == currentUri_) {
    // Source unchanged. If only the tint moved we can either retune the
    // live wrapper, peel it off, or wrap the raw paintable that's
    // already on the widget — no reload needed.
    if (tintChanged) {
      GdkPaintable* current = gtk_picture_get_paintable(GTK_PICTURE(widget_));
      if (current && RN_LINUX_IS_TINTED_PAINTABLE(current)) {
        auto* tinted = RN_LINUX_TINTED_PAINTABLE(current);
        if (tint_) {
          rn_linux_tinted_paintable_set_tint(tinted, &*tint_);
        } else {
          // Tint cleared — drop the wrapper, reinstall the raw source.
          GdkPaintable* raw = rn_linux_tinted_paintable_get_source(tinted);
          if (raw)
            g_object_ref(raw);
          gtk_picture_set_paintable(GTK_PICTURE(widget_), raw);
          if (raw)
            g_object_unref(raw);
        }
      } else if (current && tint_) {
        applyPaintable(GTK_PICTURE(widget_), current);
      }
    }
    return;
  }
  currentUri_ = uri;

  // data:image/...;base64,... — inlined assets from esbuild's
  // `loader: 'dataurl'`. Small payloads (typical RN icons / splash
  // logos) decode inline; large ones spawn a worker thread so the
  // mount commit chain doesn't stall on `gdk_pixbuf_loader_write`.
  if (uri.rfind("data:", 0) == 0) {
    std::string payload;
    if (!extractDataUriPayload(uri, payload)) {
      RNL_LOGW("Image") << "data: uri is not a recognized base64 payload (tag=" << tag_ << ")";
      gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
      return;
    }
    // Track the in-flight uri so the async completion can detect
    // supersession by a later updateProps that picked a different
    // source. The http path uses the same qdata slot — see
    // startHttpFetch.
    g_object_set_data_full(G_OBJECT(widget_), "rnl-current-uri", g_strdup(uri.c_str()), g_free);
    if (payload.size() < kDataUriAsyncThreshold) {
      GdkPixbuf* pixbuf = decodeDataUriPayload(payload);
      if (pixbuf) {
        GdkTexture* texture = gdk_texture_new_for_pixbuf(pixbuf);
        applyPaintable(GTK_PICTURE(widget_), GDK_PAINTABLE(texture));
        if (texture)
          g_object_unref(texture);
        g_object_unref(pixbuf);
      } else {
        RNL_LOGW("Image") << "data: uri decode produced no pixbuf (tag=" << tag_ << ")";
        gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
      }
    } else {
      // Clear the paintable so the box stays empty until the worker
      // lands; matches the http(s) "fetch in flight" idiom.
      gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
      startDataUriDecodeAsync(GTK_PICTURE(widget_), uri, std::move(payload));
    }
    return;
  }

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
      applyPaintable(GTK_PICTURE(widget_), GDK_PAINTABLE(stream));
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
  applyPaintable(GTK_PICTURE(widget_), GDK_PAINTABLE(tex));
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
  return base + "/" + rnlinux::applicationId() + "/soup-image-cache";
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
