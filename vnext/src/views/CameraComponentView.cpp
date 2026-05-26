#include "CameraComponentView.h"

#include "../camera/Camera.h"
#include "../components/CameraView.h"

#include <gtk/gtk.h>

namespace rnlinux {

CameraComponentView::CameraComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_picture_new();
  takeWidgetRef();
  // Default GtkPicture behavior: stretch to fill its allocation while
  // respecting the source aspect ratio. For a camera preview tile
  // that's the right look — letterbox the test-pattern frame inside
  // whatever box the React layout gives us.
  gtk_picture_set_content_fit(GTK_PICTURE(widget_), GTK_CONTENT_FIT_COVER);
  gtk_picture_set_can_shrink(GTK_PICTURE(widget_), true);

  preview_ = std::make_unique<rnlinux::camera::Preview>(GTK_PICTURE(widget_));
}

CameraComponentView::~CameraComponentView() {
  // Explicit stop before the unique_ptr resets in destructor order —
  // Preview::stop synchronously joins the GStreamer streaming
  // threads, so any in-flight onNewSample completes before the GTK
  // widget gets unparented further up the chain.
  if (preview_)
    preview_->stop();
}

void CameraComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                      facebook::react::Props const& /*newProps*/) {
  // facing/flash/zoom would flow through here in a follow-up. Today
  // we just accept any prop change without restarting the pipeline.
}

} // namespace rnlinux
