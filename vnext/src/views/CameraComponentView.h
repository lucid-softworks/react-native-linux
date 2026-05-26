#pragma once

#include "../fabric/LinuxComponentView.h"

#include <memory>

typedef struct _GtkWidget GtkWidget;

namespace rnlinux::camera {
class Preview;
}

namespace rnlinux {

// Live video preview backed by GStreamer + GdkMemoryTexture. The
// outer GtkWidget is a GtkPicture (good content-fit defaults, accepts
// arbitrary GdkPaintables) that the Preview pipeline pushes frames
// into. Lifecycle:
//   * ctor — build the GtkPicture, start a Preview pipeline against it
//   * dtor — Preview stops + tears down GStreamer state
class CameraComponentView final : public LinuxComponentView {
 public:
  explicit CameraComponentView(Tag tag);
  ~CameraComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;

 private:
  std::unique_ptr<rnlinux::camera::Preview> preview_;
};

} // namespace rnlinux
