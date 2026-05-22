#include "LinuxComponentView.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>

// When RN headers are wired:
// #include <react/renderer/core/LayoutMetrics.h>

namespace rnlinux {

LinuxComponentView::~LinuxComponentView() {
  if (widget_) {
    // Detach from parent — actual deletion happens via GTK's refcounting once
    // the parent unparents the widget.
    GtkWidget* parent = gtk_widget_get_parent(widget_);
    if (parent && GTK_IS_FIXED(parent)) {
      gtk_fixed_remove(GTK_FIXED(parent), widget_);
    }
  }
}

void LinuxComponentView::updateLayoutMetrics(
    facebook::react::LayoutMetrics const& /*metrics*/) {
  // TODO once LayoutMetrics is visible:
  //   layoutX_ = metrics.frame.origin.x;
  //   layoutY_ = metrics.frame.origin.y;
  //   layoutWidth_ = metrics.frame.size.width;
  //   layoutHeight_ = metrics.frame.size.height;
  if (!widget_) return;
  gtk_widget_set_size_request(widget_, static_cast<int>(layoutWidth_),
                              static_cast<int>(layoutHeight_));
  GtkWidget* parent = gtk_widget_get_parent(widget_);
  if (parent && GTK_IS_FIXED(parent)) {
    gtk_fixed_move(GTK_FIXED(parent), widget_, layoutX_, layoutY_);
  }
}

void LinuxComponentView::mountChild(LinuxComponentView& child, int /*index*/) {
  if (!widget_ || !child.widget()) return;
  if (!GTK_IS_FIXED(widget_)) {
    RNL_LOGW("LinuxComponentView")
        << "mountChild called on non-Fixed parent (tag=" << tag_ << ")";
    return;
  }
  gtk_fixed_put(GTK_FIXED(widget_), child.widget(), child.layoutX_,
                child.layoutY_);
}

void LinuxComponentView::unmountChild(LinuxComponentView& child, int /*index*/) {
  if (!widget_ || !child.widget() || !GTK_IS_FIXED(widget_)) return;
  gtk_fixed_remove(GTK_FIXED(widget_), child.widget());
}

}  // namespace rnlinux
