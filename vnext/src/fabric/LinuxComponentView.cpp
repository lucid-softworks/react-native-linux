#include "LinuxComponentView.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/core/LayoutMetrics.h>

#include <gtk/gtk.h>

namespace rnlinux {

LinuxComponentView::~LinuxComponentView() {
  if (widget_) {
    GtkWidget* parent = gtk_widget_get_parent(widget_);
    if (parent && GTK_IS_FIXED(parent)) {
      gtk_fixed_remove(GTK_FIXED(parent), widget_);
    }
  }
}

void LinuxComponentView::updateLayoutMetrics(
    facebook::react::LayoutMetrics const& metrics) {
  layoutX_ = metrics.frame.origin.x;
  layoutY_ = metrics.frame.origin.y;
  layoutWidth_ = metrics.frame.size.width;
  layoutHeight_ = metrics.frame.size.height;

  if (!widget_) return;
  if (layoutWidth_ > 0 || layoutHeight_ > 0) {
    gtk_widget_set_size_request(widget_,
                                static_cast<int>(layoutWidth_),
                                static_cast<int>(layoutHeight_));
  }
  GtkWidget* parent = gtk_widget_get_parent(widget_);
  if (parent && GTK_IS_FIXED(parent)) {
    gtk_fixed_move(GTK_FIXED(parent), widget_, layoutX_, layoutY_);
  }
}

void LinuxComponentView::mountChild(LinuxComponentView& child,
                                     int /*index*/) {
  if (!widget_ || !child.widget()) return;
  if (!GTK_IS_FIXED(widget_)) {
    RNL_LOGW("LinuxComponentView")
        << "mountChild on non-Fixed parent (tag=" << tag_ << ")";
    return;
  }
  // If the child is currently parented elsewhere, unparent it first —
  // GtkFixed-children can only have one parent.
  if (auto* prev = gtk_widget_get_parent(child.widget())) {
    if (GTK_IS_FIXED(prev)) gtk_fixed_remove(GTK_FIXED(prev), child.widget());
  }
  gtk_fixed_put(GTK_FIXED(widget_), child.widget(), child.layoutX_,
                child.layoutY_);
}

void LinuxComponentView::unmountChild(LinuxComponentView& child,
                                       int /*index*/) {
  if (!widget_ || !child.widget() || !GTK_IS_FIXED(widget_)) return;
  // Ensure the widget is still our child before trying to remove — RN
  // sometimes emits Remove for a node that's already been re-parented.
  if (gtk_widget_get_parent(child.widget()) == widget_) {
    gtk_fixed_remove(GTK_FIXED(widget_), child.widget());
  }
}

}  // namespace rnlinux
