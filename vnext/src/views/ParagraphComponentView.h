#pragma once

#include "../fabric/LinuxComponentView.h"

namespace rnlinux {

// Backed by a GtkLabel. RN's Paragraph holds an AttributedString assembled
// from one-or-more RawText fragments + optional inline Text styles. We
// flatten that into a PangoAttrList applied to the label.
class ParagraphComponentView final : public LinuxComponentView {
 public:
  explicit ParagraphComponentView(Tag tag);
  ~ParagraphComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;
  void updateState(facebook::react::State const& state) override;
  void updateLayoutMetrics(facebook::react::LayoutMetrics const& metrics) override;

 private:
  // Last seen nativeID. Mirrors ViewComponentView — Animated.Text wraps
  // <Text> and drives translateY / scale on the GtkLabel via
  // setNativeProp(nativeID, …); we have to register the widget in the
  // global animWidgets map so the binding can find it.
  std::string lastNativeId_;
  // Per-instance CSS provider — used to push the Yoga-computed
  // padding (contentInsets) into the GtkLabel as CSS, so the text
  // inside actually inset matches the layout box Yoga reserved.
  // Without it, Paper's outlined-input floating label puts
  // paddingHorizontal:14 in the style, Yoga widens the box by 28, but
  // GtkLabel keeps drawing the text at the widget's left edge —
  // pushing the visible glyphs off-screen the moment the wrapper's
  // animation translates the widget left.
  void* cssProvider_ = nullptr;
  std::string lastCss_;
  // Cache the last Pango markup we wrote, so a state update with the
  // same content can skip gtk_label_set_markup (which re-runs Pango's
  // markup parser + queues a relayout). On every keystroke the React
  // reconciler in persistent mode hands us fresh ParagraphState
  // objects for every sibling Paragraph in the tree — without this
  // diff, a single character pushed dozens of redundant Pango re-
  // parses and the cumulative cost showed up as visible typing lag.
  std::string lastMarkup_;
};

} // namespace rnlinux
