#pragma once

#include "../fabric/LinuxComponentView.h"

namespace rnlinux {

// Backed by a GtkFixed. View is the catch-all container in RN; children get
// absolute frames from Yoga that we apply via gtk_fixed_move +
// gtk_widget_set_size_request.
class ViewComponentView final : public LinuxComponentView {
 public:
  explicit ViewComponentView(Tag tag);
  ~ViewComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;

 private:
  void applyBackgroundColor(unsigned int argb);
  void applyOpacity(float opacity);
  void applyBorderRadius(float topLeft, float topRight,
                         float bottomRight, float bottomLeft);

  // Per-instance CSS provider for unique background/border styling.
  void* cssProvider_ = nullptr;  // GtkCssProvider* (forward-declared)
};

}  // namespace rnlinux
