#include "LinuxComponentView.h"

#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <react/renderer/core/LayoutMetrics.h>

namespace rnlinux {

LinuxComponentView::~LinuxComponentView() {
  if (widget_) {
    GtkWidget* parent = gtk_widget_get_parent(widget_);
    if (parent && GTK_IS_FIXED(parent)) {
      gtk_fixed_remove(GTK_FIXED(parent), widget_);
    }
  }
}

void LinuxComponentView::updateLayoutMetrics(facebook::react::LayoutMetrics const& metrics) {
  const float newX = metrics.frame.origin.x;
  const float newY = metrics.frame.origin.y;
  const float newW = metrics.frame.size.width;
  const float newH = metrics.frame.size.height;

  if (!widget_) {
    layoutX_ = newX;
    layoutY_ = newY;
    layoutWidth_ = newW;
    layoutHeight_ = newH;
    return;
  }

  // gtk_widget_set_size_request unconditionally calls queue_resize, which
  // bubbles a measure-invalidation up the entire ancestor chain — even if
  // the size didn't actually change. With Animated.loop firing setState
  // 60×/sec on a tree of ~600 widgets, that turned into the dominant
  // frame cost (250 ms/frame → ~4 FPS). Diff-and-skip.
  const int newWi = static_cast<int>(newW);
  const int newHi = static_cast<int>(newH);
  const int oldWi = static_cast<int>(layoutWidth_);
  const int oldHi = static_cast<int>(layoutHeight_);
  if ((newWi > 0 || newHi > 0) && (newWi != oldWi || newHi != oldHi)) {
    gtk_widget_set_size_request(widget_, newWi, newHi);
  }
  // gtk_fixed_move likewise queues a relayout on the parent; only do it
  // when the position actually moved.
  if (newX != layoutX_ || newY != layoutY_) {
    GtkWidget* parent = gtk_widget_get_parent(widget_);
    if (parent && GTK_IS_FIXED(parent)) {
      gtk_fixed_move(GTK_FIXED(parent), widget_, newX, newY);
    }
  }

  layoutX_ = newX;
  layoutY_ = newY;
  layoutWidth_ = newW;
  layoutHeight_ = newH;
}

void LinuxComponentView::mountChild(LinuxComponentView& child, int /*index*/) {
  if (!widget_ || !child.widget())
    return;
  if (!GTK_IS_FIXED(widget_)) {
    RNL_LOGW("LinuxComponentView") << "mountChild on non-Fixed parent (tag=" << tag_ << ")";
    return;
  }
  // If the child is currently parented elsewhere, unparent it first —
  // GtkFixed-children can only have one parent.
  if (auto* prev = gtk_widget_get_parent(child.widget())) {
    if (GTK_IS_FIXED(prev))
      gtk_fixed_remove(GTK_FIXED(prev), child.widget());
  }
  gtk_fixed_put(GTK_FIXED(widget_), child.widget(), child.layoutX_, child.layoutY_);
}

void LinuxComponentView::unmountChild(LinuxComponentView& child, int /*index*/) {
  if (!widget_ || !child.widget() || !GTK_IS_FIXED(widget_))
    return;
  // Ensure the widget is still our child before trying to remove — RN
  // sometimes emits Remove for a node that's already been re-parented.
  if (gtk_widget_get_parent(child.widget()) == widget_) {
    gtk_fixed_remove(GTK_FIXED(widget_), child.widget());
  }
}

} // namespace rnlinux
