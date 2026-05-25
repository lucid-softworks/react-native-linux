#include "ScrollViewComponentView.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutMetrics.h>

#include <gtk/gtk.h>

#include <string>

namespace rnlinux {

ScrollViewComponentView::ScrollViewComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_scrolled_window_new();
  gtk_scrolled_window_set_policy(GTK_SCROLLED_WINDOW(widget_),
                                 GTK_POLICY_AUTOMATIC,
                                 GTK_POLICY_AUTOMATIC);
  // Force visible scrollbars (no overlay fade) — helpful in VNC
  // sessions where the GTK overlay-scrollbar fade animation makes
  // bars invisible until hover, and makes the demo unambiguous.
  gtk_scrolled_window_set_overlay_scrolling(
      GTK_SCROLLED_WINDOW(widget_), FALSE);
  // Inner viewport holding children. Yoga lays out absolutely-frame'd
  // children, so a GtkFixed is the right container — it lets us
  // gtk_fixed_put each at its (x,y) and let GTK request scrollbars
  // when our requested size exceeds the viewport.
  innerFixed_ = gtk_fixed_new();
  gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(widget_), innerFixed_);

  // Per-instance CSS name so styling rules (set later by updateProps —
  // backgroundColor etc.) can target this scrollview without leaking
  // to siblings.
  const std::string cssName = "rnl-scroll-" + std::to_string(tag);
  gtk_widget_set_name(widget_, cssName.c_str());
}

ScrollViewComponentView::~ScrollViewComponentView() = default;

void ScrollViewComponentView::updateProps(
    facebook::react::Props const& /*oldProps*/,
    facebook::react::Props const& newProps) {
  // ScrollViewProps inherits ViewProps so it carries backgroundColor,
  // borderRadius, etc. — but our base class only renders those on a
  // ViewComponentView's per-instance CSS provider. For the MVP we
  // honour the ScrollView-specific scroll-policy props and leave
  // visual styling to a wrapping <View>. Apps typically do:
  //   <View backgroundColor="#fff" borderRadius={12}>
  //     <ScrollView>...</ScrollView>
  //   </View>
  const auto& sp = static_cast<const facebook::react::ScrollViewProps&>(newProps);
  // showsHorizontalScrollIndicator / showsVerticalScrollIndicator can
  // hint the policy to NEVER for that axis. AUTOMATIC otherwise.
  auto* sw = GTK_SCROLLED_WINDOW(widget_);
  GtkPolicyType h = sp.showsHorizontalScrollIndicator
                       ? GTK_POLICY_AUTOMATIC : GTK_POLICY_NEVER;
  GtkPolicyType v = sp.showsVerticalScrollIndicator
                       ? GTK_POLICY_AUTOMATIC : GTK_POLICY_NEVER;
  // horizontal? Most apps want vertical-only — if `horizontal` is set
  // we swap, mirroring RN's "horizontal" prop on iOS/Android.
  if (sp.horizontal) {
    gtk_scrolled_window_set_policy(sw, h, GTK_POLICY_NEVER);
  } else {
    gtk_scrolled_window_set_policy(sw, GTK_POLICY_NEVER, v);
  }
}

void ScrollViewComponentView::updateLayoutMetrics(
    facebook::react::LayoutMetrics const& metrics) {
  // The OUTER widget (the GtkScrolledWindow) gets the viewport size +
  // position. Base class handles that. The INNER GtkFixed sizes
  // itself from the children's bounding box in postLayoutPass() —
  // children may not have their frames set at the time this fires.
  LinuxComponentView::updateLayoutMetrics(metrics);
}

void ScrollViewComponentView::postLayoutPass() {
  if (!innerFixed_) return;
  // Bounding box of inner children → the scrollable extent. By
  // postLayoutPass time every nested view has had updateLayoutMetrics
  // applied, so widget positions + size_requests are settled.
  int maxRight = 0, maxBottom = 0;
  for (GtkWidget* child = gtk_widget_get_first_child(innerFixed_);
       child != nullptr;
       child = gtk_widget_get_next_sibling(child)) {
    double x = 0, y = 0;
    gtk_fixed_get_child_position(GTK_FIXED(innerFixed_), child, &x, &y);
    int w = 0, h = 0;
    gtk_widget_get_size_request(child, &w, &h);
    const int right  = static_cast<int>(x) + w;
    const int bottom = static_cast<int>(y) + h;
    if (right > maxRight)  maxRight  = right;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  gtk_widget_set_size_request(innerFixed_, maxRight, maxBottom);
}

void ScrollViewComponentView::mountChild(LinuxComponentView& child,
                                          int /*index*/) {
  if (!innerFixed_ || !child.widget()) return;
  if (auto* prev = gtk_widget_get_parent(child.widget())) {
    if (GTK_IS_FIXED(prev)) {
      gtk_fixed_remove(GTK_FIXED(prev), child.widget());
    }
  }
  gtk_fixed_put(GTK_FIXED(innerFixed_), child.widget(),
                /*x=*/0, /*y=*/0);
  // Position is set by updateLayoutMetrics on the child after Insert.
}

void ScrollViewComponentView::unmountChild(LinuxComponentView& child,
                                            int /*index*/) {
  if (!innerFixed_ || !child.widget()) return;
  if (gtk_widget_get_parent(child.widget()) == innerFixed_) {
    gtk_fixed_remove(GTK_FIXED(innerFixed_), child.widget());
  }
}

}  // namespace rnlinux
