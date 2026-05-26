#pragma once

#include "../fabric/LinuxComponentView.h"

typedef struct _GtkWidget GtkWidget;

namespace rnlinux {

// Backed by a GtkScrolledWindow wrapping an inner GtkFixed. Yoga lays
// out the inner GtkFixed at the union of its children's frames; the
// scrolled-window's adjustments then expose a viewport of the size we
// were given by the layout pass.
//
// Children are added to / removed from the inner fixed; that's what
// our base class `widget()` returns to LinuxMountingManager's
// gtk_fixed_put/move calls.
class ScrollViewComponentView final : public LinuxComponentView {
 public:
  explicit ScrollViewComponentView(Tag tag);
  ~ScrollViewComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;

  void updateLayoutMetrics(facebook::react::LayoutMetrics const& metrics) override;

  // Override so children get put into our INNER GtkFixed (innerFixed_),
  // not the outer GtkScrolledWindow we hand to the base class.
  void mountChild(LinuxComponentView& child, int index) override;
  void unmountChild(LinuxComponentView& child, int index) override;

  // Called by LinuxMountingManager at the end of each transaction. We
  // walk the inner GtkFixed's children, sum their frames, and
  // gtk_widget_set_size_request the inner Fixed accordingly so
  // GtkScrolledWindow knows the scrollable extent.
  void postLayoutPass() override;

 private:
  // Cull children whose rect doesn't intersect the visible viewport
  // by toggling gtk_widget_set_child_visible. Currently disabled in
  // favor of JS-side onScroll virtualization (see emitScroll); kept
  // here as scaffolding to revisit later.
  void updateChildVisibility();

  // Forward the current scroll offset + extents to the JS-side
  // fabricOnScroll handler registered for this tag. Called from the
  // GtkAdjustment value-changed signal — fires up to 60 Hz during an
  // active scroll, so dispatchFabricScroll deliberately skips the
  // microtask drain (FlatList batches via setState).
  void emitScroll();

  // GtkScrolledWindow is the OUTER widget the parent attaches to (i.e.
  // widget_, owned by LinuxComponentView). The inner viewport
  // (innerFixed_) is what we hand out as the "child slot" — child
  // views get gtk_fixed_put into it, and Yoga's content rect drives
  // its requested size.
  GtkWidget* innerFixed_ = nullptr;
  // The actual GtkScrolledWindow. widget_ (owned by the base class) is
  // an RnlSurfaceClamp wrapping this — the clamp's measure returns our
  // set_size_request as natural, so the parent GtkFixed allocates us
  // to Yoga's frame instead of the scrolled window's content-derived
  // natural (which would be the full FlatList content height and
  // collapse scrolling).
  GtkWidget* scrolledWindow_ = nullptr;
};

} // namespace rnlinux
