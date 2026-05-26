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

} // namespace rnlinux
