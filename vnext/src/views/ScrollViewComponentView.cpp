#include "ScrollViewComponentView.h"

#include "../jsi/RnLinuxBindings.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <react/renderer/components/scrollview/ScrollViewProps.h>
#include <react/renderer/components/scrollview/ScrollViewState.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <string>

namespace rnlinux {

ScrollViewComponentView::ScrollViewComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_scrolled_window_new();
  gtk_scrolled_window_set_policy(
      GTK_SCROLLED_WINDOW(widget_), GTK_POLICY_AUTOMATIC, GTK_POLICY_AUTOMATIC);
  // Force visible scrollbars (no overlay fade) — helpful in VNC
  // sessions where the GTK overlay-scrollbar fade animation makes
  // bars invisible until hover, and makes the demo unambiguous.
  gtk_scrolled_window_set_overlay_scrolling(GTK_SCROLLED_WINDOW(widget_), FALSE);
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

  // Forward GtkAdjustment value-changed to the JS-side scroll handler
  // (registered via rnLinux.fabricOnScroll(tag, fn)). This is what
  // powers the FlatList shim's JS-side virtualization — it tracks
  // scrollY and only renders items in the visible window.
  auto onAdj = [](GtkAdjustment* /*adj*/, gpointer ud) {
    static_cast<ScrollViewComponentView*>(ud)->emitScroll();
  };
  GtkAdjustment* vadj = gtk_scrolled_window_get_vadjustment(GTK_SCROLLED_WINDOW(widget_));
  GtkAdjustment* hadj = gtk_scrolled_window_get_hadjustment(GTK_SCROLLED_WINDOW(widget_));
  g_signal_connect(vadj, "value-changed", G_CALLBACK(+onAdj), this);
  g_signal_connect(hadj, "value-changed", G_CALLBACK(+onAdj), this);
}

void ScrollViewComponentView::emitScroll() {
  if (!widget_)
    return;
  GtkAdjustment* vadj = gtk_scrolled_window_get_vadjustment(GTK_SCROLLED_WINDOW(widget_));
  GtkAdjustment* hadj = gtk_scrolled_window_get_hadjustment(GTK_SCROLLED_WINDOW(widget_));
  const double offsetX = hadj ? gtk_adjustment_get_value(hadj) : 0.0;
  const double offsetY = vadj ? gtk_adjustment_get_value(vadj) : 0.0;
  // upper - lower is the full content extent in adjustment units.
  // page-size is the visible viewport extent.
  const double contentW =
      hadj ? gtk_adjustment_get_upper(hadj) - gtk_adjustment_get_lower(hadj) : 0.0;
  const double contentH =
      vadj ? gtk_adjustment_get_upper(vadj) - gtk_adjustment_get_lower(vadj) : 0.0;
  const double viewportW = hadj ? gtk_adjustment_get_page_size(hadj) : 0.0;
  const double viewportH = vadj ? gtk_adjustment_get_page_size(vadj) : 0.0;
  dispatchFabricScroll(tag_, offsetX, offsetY, contentW, contentH, viewportW, viewportH);
}

ScrollViewComponentView::~ScrollViewComponentView() = default;

void ScrollViewComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
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
  GtkPolicyType h = sp.showsHorizontalScrollIndicator ? GTK_POLICY_AUTOMATIC : GTK_POLICY_NEVER;
  GtkPolicyType v = sp.showsVerticalScrollIndicator ? GTK_POLICY_AUTOMATIC : GTK_POLICY_NEVER;
  // horizontal? Most apps want vertical-only — if `horizontal` is set
  // we swap, mirroring RN's "horizontal" prop on iOS/Android.
  if (sp.horizontal) {
    gtk_scrolled_window_set_policy(sw, h, GTK_POLICY_NEVER);
  } else {
    gtk_scrolled_window_set_policy(sw, GTK_POLICY_NEVER, v);
  }
}

void ScrollViewComponentView::updateLayoutMetrics(facebook::react::LayoutMetrics const& metrics) {
  // The OUTER widget (the GtkScrolledWindow) gets the viewport size +
  // position. Base class handles that. The INNER GtkFixed sizes
  // itself from the children's bounding box in postLayoutPass() —
  // children may not have their frames set at the time this fires.
  LinuxComponentView::updateLayoutMetrics(metrics);
}

void ScrollViewComponentView::postLayoutPass() {
  if (!innerFixed_)
    return;
  // Bounding box of inner children → the scrollable extent. By
  // postLayoutPass time every nested view has had updateLayoutMetrics
  // applied, so widget positions + size_requests are settled.
  int maxRight = 0, maxBottom = 0;
  for (GtkWidget* child = gtk_widget_get_first_child(innerFixed_); child != nullptr;
       child = gtk_widget_get_next_sibling(child)) {
    double x = 0, y = 0;
    gtk_fixed_get_child_position(GTK_FIXED(innerFixed_), child, &x, &y);
    int w = 0, h = 0;
    gtk_widget_get_size_request(child, &w, &h);
    const int right = static_cast<int>(x) + w;
    const int bottom = static_cast<int>(y) + h;
    if (right > maxRight)
      maxRight = right;
    if (bottom > maxBottom)
      maxBottom = bottom;
  }
  gtk_widget_set_size_request(innerFixed_, maxRight, maxBottom);

  // Layout changed → re-evaluate which children intersect the viewport.
  // postLayoutPass runs after the mounting transaction so child sizes
  // and positions are settled; cheap to re-check.
  updateChildVisibility();
}

namespace {

// Recursively cull descendants of `node` whose bounds (in
// `coordRoot`'s coordinate system) don't intersect `viewport`.
//
// gtk_widget_compute_bounds gives us the post-layout extent of any
// widget in any ancestor's coords — perfect for an absolute hit-test
// against the scrolled-window viewport. We toggle gtk_widget_set_
// child_visible (NOT gtk_widget_set_visible) so the widget stays in
// the layout — that keeps the scrollable extent stable — but GTK
// skips it during the paint pass.
//
// We recurse because FlatList's JS shim wraps its items in a single
// container View (so it can apply flexDirection:column); checking
// only the direct child of innerFixed_ would see one giant View that
// always overlaps the viewport. The real per-item culling lives one
// level below that.
void cullSubtree(GtkWidget* node, GtkWidget* coordRoot, const graphene_rect_t& viewport) {
  for (GtkWidget* child = gtk_widget_get_first_child(node); child != nullptr;
       child = gtk_widget_get_next_sibling(child)) {
    graphene_rect_t bounds;
    if (gtk_widget_compute_bounds(child, coordRoot, &bounds)) {
      const bool visible = (bounds.origin.x + bounds.size.width > viewport.origin.x) &&
                           (bounds.origin.x < viewport.origin.x + viewport.size.width) &&
                           (bounds.origin.y + bounds.size.height > viewport.origin.y) &&
                           (bounds.origin.y < viewport.origin.y + viewport.size.height);
      // gtk_widget_set_child_visible always queues a relayout on the
      // parent — even when the value is the same. With ~500 widgets
      // under a non-virtualized FlatList that's a relayout per child
      // per scroll tick, which is exactly the load we're trying to
      // shed. Diff-skip is the whole game.
      if (gtk_widget_get_child_visible(child) != visible) {
        gtk_widget_set_child_visible(child, visible ? TRUE : FALSE);
      }
      // If a parent is off-screen we could skip its subtree entirely,
      // but recursing is cheap (we exited above on cull) and keeps
      // visibility correct for nested hits when a parent dips out and
      // back during a fast scroll.
      if (visible) {
        cullSubtree(child, coordRoot, viewport);
      }
    }
  }
}

} // namespace

void ScrollViewComponentView::updateChildVisibility() {
  // Short-circuit: see ctor comment. The bounds walk is correct but
  // turned out to cost more (~30 ms per setTick at 80 items) than it
  // saves by hiding off-screen children. Re-enable once JS-side
  // virtualization gates this work to FlatList ScrollViews only.
  return;
  if (!innerFixed_ || !widget_)
    return;
  GtkAdjustment* vadj = gtk_scrolled_window_get_vadjustment(GTK_SCROLLED_WINDOW(widget_));
  GtkAdjustment* hadj = gtk_scrolled_window_get_hadjustment(GTK_SCROLLED_WINDOW(widget_));
  const double scrollX = hadj ? gtk_adjustment_get_value(hadj) : 0.0;
  const double scrollY = vadj ? gtk_adjustment_get_value(vadj) : 0.0;
  const int viewportW = gtk_widget_get_width(widget_);
  const int viewportH = gtk_widget_get_height(widget_);
  if (viewportW <= 0 || viewportH <= 0)
    return;

  // One-screen overscan in each direction so the items just past the
  // edge are ready before they scroll into view. Smaller saves more
  // paint cost but risks flashing during fast scrolls.
  const float overscan = static_cast<float>(viewportH);
  graphene_rect_t viewport = {
      {static_cast<float>(scrollX) - overscan, static_cast<float>(scrollY) - overscan},
      {static_cast<float>(viewportW) + 2 * overscan, static_cast<float>(viewportH) + 2 * overscan}};

  cullSubtree(innerFixed_, innerFixed_, viewport);
}

void ScrollViewComponentView::mountChild(LinuxComponentView& child, int /*index*/) {
  if (!innerFixed_ || !child.widget())
    return;
  if (auto* prev = gtk_widget_get_parent(child.widget())) {
    if (GTK_IS_FIXED(prev)) {
      gtk_fixed_remove(GTK_FIXED(prev), child.widget());
    }
  }
  gtk_fixed_put(GTK_FIXED(innerFixed_),
                child.widget(),
                /*x=*/0,
                /*y=*/0);
  // Position is set by updateLayoutMetrics on the child after Insert.
}

void ScrollViewComponentView::unmountChild(LinuxComponentView& child, int /*index*/) {
  if (!innerFixed_ || !child.widget())
    return;
  if (gtk_widget_get_parent(child.widget()) == innerFixed_) {
    gtk_fixed_remove(GTK_FIXED(innerFixed_), child.widget());
  }
}

} // namespace rnlinux
