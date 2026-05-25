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

  void updateLayoutMetrics(
      facebook::react::LayoutMetrics const& metrics) override;

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
  // GtkScrolledWindow is the OUTER widget the parent attaches to (i.e.
  // widget_, owned by LinuxComponentView). The inner viewport
  // (innerFixed_) is what we hand out as the "child slot" — child
  // views get gtk_fixed_put into it, and Yoga's content rect drives
  // its requested size.
  GtkWidget* innerFixed_ = nullptr;
};

}  // namespace rnlinux
