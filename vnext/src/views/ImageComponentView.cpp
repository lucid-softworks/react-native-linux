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

#include <cstring>

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
// One process-wide SoupSession — sessions are thread-safe and reusing
// one gets HTTP keep-alive across image loads.
SoupSession* sharedSession() {
  static SoupSession* s = soup_session_new();
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

} // namespace rnlinux
