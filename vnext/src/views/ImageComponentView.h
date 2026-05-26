#pragma once

#include "../fabric/LinuxComponentView.h"

#include <string>

namespace rnlinux {

// Backed by a GtkPicture. Reads the first ImageSource's URI from
// ImageProps and loads it via GdkTexture. file:// is loaded
// synchronously; http(s):// loads in a worker (or simply errors for
// now) — we'll fold async networking in once a real ImageRequest
// pipeline lands.
class ImageComponentView final : public LinuxComponentView {
 public:
  explicit ImageComponentView(Tag tag);
  ~ImageComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;

 private:
  std::string currentUri_;
};

// Process-wide image-cache helpers. The HTTP fetcher attaches a
// SoupCache (when libsoup is linked) under
// $XDG_CACHE_HOME/rn-linux-playground/soup-image-cache so cached
// responses survive process restarts. `clearImageCache()` wipes
// both the in-memory entries and the on-disk cache files; bound
// to `rnLinux.imageClearCache` and surfaced as
// expo-image's `Image.clearDiskCache`.
void clearImageCache();
std::string imageCacheDir();

} // namespace rnlinux
