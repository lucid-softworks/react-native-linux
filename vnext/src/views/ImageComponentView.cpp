#include "ImageComponentView.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/components/image/ImageProps.h>
#include <react/renderer/imagemanager/primitives.h>

#include <gtk/gtk.h>

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

GtkContentFit toContentFit(facebook::react::ImageResizeMode mode) {
  switch (mode) {
    case facebook::react::ImageResizeMode::Cover:   return GTK_CONTENT_FIT_COVER;
    case facebook::react::ImageResizeMode::Contain: return GTK_CONTENT_FIT_CONTAIN;
    case facebook::react::ImageResizeMode::Stretch: return GTK_CONTENT_FIT_FILL;
    case facebook::react::ImageResizeMode::Center:  return GTK_CONTENT_FIT_SCALE_DOWN;
    case facebook::react::ImageResizeMode::Repeat:  return GTK_CONTENT_FIT_FILL;
  }
  return GTK_CONTENT_FIT_CONTAIN;
}

}  // namespace

ImageComponentView::ImageComponentView(Tag tag) : LinuxComponentView(tag) {
  widget_ = gtk_picture_new();
  // GtkPicture defaults to expand=TRUE which lets it grow into its
  // allocation — we want it to fill whatever frame Yoga gives us.
  gtk_widget_set_hexpand(widget_, TRUE);
  gtk_widget_set_vexpand(widget_, TRUE);
  // CAN_SHRINK lets the image scale down inside small bounds; without
  // it GtkPicture insists on natural size and the parent gets pushed.
  gtk_picture_set_can_shrink(GTK_PICTURE(widget_), TRUE);
}

ImageComponentView::~ImageComponentView() = default;

void ImageComponentView::updateProps(
    facebook::react::Props const& /*oldProps*/,
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

  // file:// is the only scheme we load synchronously for now. http(s)
  // would need an async fetch + texture decode pass; punt with a
  // warning so apps don't fail silently.
  const auto path = fileSchemePath(uri);
  if (path.empty()) {
    RNL_LOGW("Image") << "unsupported uri scheme (tag=" << tag_
                       << "): " << uri;
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
    return;
  }

  GFile* gfile = g_file_new_for_path(path.c_str());
  GError* err = nullptr;
  GdkTexture* tex = gdk_texture_new_from_file(gfile, &err);
  g_object_unref(gfile);
  if (!tex) {
    RNL_LOGW("Image") << "load failed (tag=" << tag_ << "): "
                       << (err ? err->message : "(unknown)");
    if (err) g_error_free(err);
    gtk_picture_set_paintable(GTK_PICTURE(widget_), nullptr);
    return;
  }
  gtk_picture_set_paintable(GTK_PICTURE(widget_), GDK_PAINTABLE(tex));
  g_object_unref(tex);
}

}  // namespace rnlinux
