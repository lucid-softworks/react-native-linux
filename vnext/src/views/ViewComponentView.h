#pragma once

#include "../fabric/LinuxComponentView.h"

#include <array>
#include <react/renderer/graphics/Transform.h>
#include <string>

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

  void updateLayoutMetrics(facebook::react::LayoutMetrics const& metrics) override;

 private:
  void applyBackgroundColor(unsigned int argb);
  void applyOpacity(float opacity);
  void applyBorderRadius(float topLeft, float topRight, float bottomRight, float bottomLeft);
  // Apply the cached transform (lastTransform_) to our widget via
  // gtk_fixed_set_child_transform on our parent. No-op if the parent
  // isn't a GtkFixed yet (the widget hasn't been mounted into the
  // tree); re-runs from updateLayoutMetrics, which fires post-insert
  // and gives the parent a chance to be set.
  void applyTransform();

  // Per-instance CSS provider for unique background/border styling.
  void* cssProvider_ = nullptr; // GtkCssProvider* (forward-declared)
  // Last stylesheet pushed to cssProvider_. Animated views can hit
  // updateProps() ~60 Hz for opacity/transform changes that don't
  // touch CSS (opacity is gtk_widget_set_opacity, not a CSS rule); the
  // load_from_string call is expensive (re-parse + re-style-invalidate),
  // so skip it when the stylesheet is byte-identical.
  std::string lastCss_;
  // Cached opacity so we don't re-issue gtk_widget_set_opacity when the
  // value is unchanged (each call invalidates a redraw).
  float lastOpacity_ = -1.0f;
  // Last seen nativeID. When this changes (or the view is destroyed)
  // we update the global animWidgets map in RnLinuxBindings so the
  // Animated native driver's setNativeProp(stringId, …) can find us.
  std::string lastNativeId_;
  // Cached transform operations + origin from the most recent
  // updateProps. The final 4×4 matrix is composed lazily in
  // applyTransform() because transform-origin defaults to 50% / 50%
  // of the view's frame, which isn't known until updateLayoutMetrics
  // runs after the first layout pass.
  std::vector<facebook::react::TransformOperation> transformOps_;
  facebook::react::TransformOrigin transformOrigin_;
  // Last matrix we actually pushed to GTK. Tracked separately from
  // the ops so we can short-circuit re-applying when neither the
  // ops nor the layout size changed the resolved matrix.
  std::array<float, 16> lastTransform_{{1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}};
  bool transformApplied_ = false;
};

} // namespace rnlinux
