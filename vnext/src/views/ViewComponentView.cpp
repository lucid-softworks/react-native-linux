#include "ViewComponentView.h"

#include "../jsi/RnLinuxBindings.h"
#include "react-native-linux/Logging.h"

#include <cstdio>
#include <gtk/gtk.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/HostPlatformColor.h>
#include <string>

namespace rnlinux {

namespace {

// SharedColor → CSS rgba(…). RN packs colors as 0xAARRGGBB
// (HostPlatformColor.h). Returns an empty string when the color
// hasn't been set (UndefinedColor), so callers can skip emitting
// rules for properties the app didn't touch.
std::string colorToCss(const facebook::react::SharedColor& color) {
  if (!color)
    return {};
  const auto v = static_cast<unsigned int>(*color);
  char buf[40];
  std::snprintf(buf,
                sizeof(buf),
                "rgba(%u,%u,%u,%.3f)",
                (v >> 16) & 0xff,
                (v >> 8) & 0xff,
                v & 0xff,
                ((v >> 24) & 0xff) / 255.0);
  return buf;
}

} // namespace

ViewComponentView::ViewComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_fixed_new();
  takeWidgetRef();
  // Tag every widget with a unique CSS name so per-instance style rules
  // (background, border) can target it without affecting siblings.
  std::string cssName = "rnl-view-" + std::to_string(tag);
  gtk_widget_set_name(widget_, cssName.c_str());

  auto* provider = gtk_css_provider_new();
  cssProvider_ = provider;
  gtk_style_context_add_provider_for_display(gtk_widget_get_display(widget_),
                                             GTK_STYLE_PROVIDER(provider),
                                             GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);

  // Single GtkGestureClick per View — the registered Fabric handler
  // (set by JS via rnLinux.fabricOnClick(tag, fn)) is looked up at
  // call time, so the gesture is wired once and stays inert if the
  // tree has no onClick prop. dispatchFabricClick is a no-op when no
  // handler is registered.
  auto* gesture = gtk_gesture_click_new();
  g_signal_connect_data(
      gesture,
      "released",
      G_CALLBACK(
          +[](GtkGestureClick* /*gc*/, int /*n_press*/, double /*x*/, double /*y*/, gpointer ud) {
            const int t = GPOINTER_TO_INT(ud);
            dispatchFabricClick(t);
          }),
      GINT_TO_POINTER(static_cast<int>(tag)),
      /*destroy=*/nullptr,
      /*flags=*/static_cast<GConnectFlags>(0));
  gtk_widget_add_controller(widget_, GTK_EVENT_CONTROLLER(gesture));
}

ViewComponentView::~ViewComponentView() {
  if (!lastNativeId_.empty()) {
    unregisterAnimWidget(lastNativeId_);
  }
  if (cssProvider_) {
    g_object_unref(static_cast<GtkCssProvider*>(cssProvider_));
  }
}

void ViewComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                    facebook::react::Props const& newProps) {
  // On Create, the mounting manager calls us with (newProps, newProps)
  // since there's no real "old" yet — a naive (oldVP != newVP) diff
  // would skip the very first prop application. Just always rebuild
  // the full per-widget stylesheet from current values.
  const auto& vp = static_cast<const facebook::react::ViewProps&>(newProps);

  // Compose a single CSS block for the widget. GtkCssProvider's
  // load_from_string REPLACES — emitting one rule with all properties
  // is the only way to combine background + border + radius. The
  // selector targets our unique gtk_widget_set_name() id.
  std::string css = std::string{"#"} + gtk_widget_get_name(widget_) + " {";

  if (vp.backgroundColor) {
    css += " background-color: " + colorToCss(vp.backgroundColor) + ";";
  }

  // Borders. ViewProps stores them as CascadedRectangleEdges /
  // CascadedRectangleCorners — each per-side slot is optional with a
  // separate `all` fallback. We resolve each side individually so a
  // JS app can write either `borderWidth: 2` (sets `all`) or
  // `borderTopWidth: 2` (sets just `top`).
  auto bw = vp.getBorderWidths();
  const float bwTop = bw.top.value_or(bw.all.value_or(0.0f));
  const float bwRight = bw.right.value_or(bw.all.value_or(0.0f));
  const float bwBot = bw.bottom.value_or(bw.all.value_or(0.0f));
  const float bwLeft = bw.left.value_or(bw.all.value_or(0.0f));
  char buf[120];
  if (bwTop > 0 || bwRight > 0 || bwBot > 0 || bwLeft > 0) {
    std::snprintf(buf,
                  sizeof(buf),
                  " border-width: %.0fpx %.0fpx %.0fpx %.0fpx;",
                  bwTop,
                  bwRight,
                  bwBot,
                  bwLeft);
    css += buf;
    css += " border-style: solid;";
  }

  // Border color — for the MVP, pick the most specific slot in
  // top-priority order. Per-side colors would mean emitting
  // border-top-color, border-right-color, etc.
  auto pickColor = [&](const std::optional<facebook::react::SharedColor>& side) {
    if (side && *side)
      return colorToCss(*side);
    if (vp.borderColors.all && *vp.borderColors.all) {
      return colorToCss(*vp.borderColors.all);
    }
    return std::string{};
  };
  const auto bcTop = pickColor(vp.borderColors.top);
  if (!bcTop.empty()) {
    css += " border-color: " + bcTop + ";";
  }

  // Per-corner border radius. ValueUnit holds {value, unit}; we
  // treat both Point and Percent as plain pixels for now — a real
  // length resolver against layoutMetrics.frame.size lands later.
  auto pickRadius = [&](const std::optional<facebook::react::ValueUnit>& corner) {
    if (corner && corner->value > 0)
      return corner->value;
    if (vp.borderRadii.all && vp.borderRadii.all->value > 0) {
      return vp.borderRadii.all->value;
    }
    return 0.0f;
  };
  const float rTL = pickRadius(vp.borderRadii.topLeft);
  const float rTR = pickRadius(vp.borderRadii.topRight);
  const float rBR = pickRadius(vp.borderRadii.bottomRight);
  const float rBL = pickRadius(vp.borderRadii.bottomLeft);
  if (rTL > 0 || rTR > 0 || rBR > 0 || rBL > 0) {
    std::snprintf(
        buf, sizeof(buf), " border-radius: %.0fpx %.0fpx %.0fpx %.0fpx;", rTL, rTR, rBR, rBL);
    css += buf;
  }

  css += " }";
  // load_from_string re-parses the stylesheet AND invalidates the
  // GtkStyleContext for every widget matched by the selector. With
  // Animated.View triggering updateProps 60 Hz on opacity-only changes
  // (which don't touch CSS), this was the dominant per-frame cost.
  // Skip when the generated CSS is identical to what we last pushed.
  if (css != lastCss_) {
    gtk_css_provider_load_from_string(static_cast<GtkCssProvider*>(cssProvider_), css.c_str());
    lastCss_ = std::move(css);
  }

  // Opacity sits on the widget directly (no CSS), simpler than going
  // through filter: opacity(). Skip when unchanged — each call queues
  // a redraw.
  if (!std::isnan(vp.opacity) && vp.opacity != lastOpacity_) {
    gtk_widget_set_opacity(widget_, vp.opacity);
    lastOpacity_ = vp.opacity;
  }

  // Sync nativeID into the global Animated-driver lookup. JS-side
  // animated.js generates a unique nativeID per Animated.* host so
  // setNativeProp(nativeID, prop, value) can address us without
  // going through a React ref (our reconciler doesn't support refs
  // cleanly yet).
  if (vp.nativeId != lastNativeId_) {
    if (!lastNativeId_.empty())
      unregisterAnimWidget(lastNativeId_);
    if (!vp.nativeId.empty())
      registerAnimWidget(vp.nativeId, widget_);
    lastNativeId_ = vp.nativeId;
  }

  // Cache the raw operations + origin; final 4×4 matrix is composed
  // in applyTransform() once the layout size is known (operations
  // can reference frame-relative units, and the default transform-
  // origin is 50% / 50% of the view's frame).
  transformOps_ = vp.transform.operations;
  transformOrigin_ = vp.transformOrigin;
  applyTransform();
}

void ViewComponentView::updateLayoutMetrics(facebook::react::LayoutMetrics const& metrics) {
  LinuxComponentView::updateLayoutMetrics(metrics);
  // updateProps fires during handleCreate when widget_ has no parent
  // yet; handleInsert runs next. updateLayoutMetrics fires after
  // insert, which is the first point a transform can actually be
  // attached. Re-attempt here once per insert lifecycle.
  if (!transformApplied_) {
    applyTransform();
  }
}

void ViewComponentView::applyTransform() {
  if (!widget_)
    return;
  GtkWidget* parent = gtk_widget_get_parent(widget_);
  if (!parent || !GTK_IS_FIXED(parent))
    return;

  // Compose the final 4×4 transform around the view's transform-
  // origin. RN's RawProps→Transform parser pushes operations into
  // the list but leaves matrix as identity for everything but the
  // literal `[{matrix: [...]}]` form, so we walk operations
  // ourselves through Transform::FromTransformOperation and wrap
  // the result in translate(origin) · M · translate(-origin) to
  // match CSS `transform-origin` semantics.
  facebook::react::Size frameSize{layoutWidth_, layoutHeight_};
  facebook::react::Transform user = facebook::react::Transform::Identity();
  for (auto const& op : transformOps_) {
    user = user * facebook::react::Transform::FromTransformOperation(op, frameSize);
  }
  // Default transform-origin is (50%, 50%, 0). Resolve to absolute
  // pixel offsets from the view's top-left.
  float originX = layoutWidth_ * 0.5f;
  float originY = layoutHeight_ * 0.5f;
  float originZ = transformOrigin_.z;
  if (transformOrigin_.xy.size() > 0) {
    const auto& ox = transformOrigin_.xy[0];
    if (ox.unit == facebook::react::UnitType::Point)
      originX = ox.value;
    else if (ox.unit == facebook::react::UnitType::Percent)
      originX = layoutWidth_ * ox.value / 100.0f;
  }
  if (transformOrigin_.xy.size() > 1) {
    const auto& oy = transformOrigin_.xy[1];
    if (oy.unit == facebook::react::UnitType::Point)
      originY = oy.value;
    else if (oy.unit == facebook::react::UnitType::Percent)
      originY = layoutHeight_ * oy.value / 100.0f;
  }
  auto composed = facebook::react::Transform::Translate(originX, originY, originZ) * user *
                  facebook::react::Transform::Translate(-originX, -originY, -originZ);

  for (size_t i = 0; i < 16; ++i) {
    lastTransform_[i] = static_cast<float>(composed.matrix[i]);
  }

  static constexpr std::array<float, 16> kIdentity{
      {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1}};
  const bool isIdentity = (lastTransform_ == kIdentity);

  // GtkFixed stores child positions AS a GskTransform — gtk_fixed_move
  // and gtk_fixed_set_child_transform write to the same slot, the
  // latter overwriting the former. If we want both Yoga's layout
  // position AND a CSS transform applied, we have to compose them
  // into a single GskTransform here.
  //
  // When the matrix is identity, leave the layout position alone —
  // gtk_fixed_move has already written it via the base class's
  // updateLayoutMetrics, and we'd just be re-doing the same work.
  if (isIdentity) {
    if (transformApplied_) {
      // Previously had a non-identity transform; restore the bare
      // translate so we don't keep displaying scaled/rotated content
      // on top of an updated layout.
      graphene_point_t pt = {layoutX_, layoutY_};
      GskTransform* t = gsk_transform_translate(nullptr, &pt);
      gtk_fixed_set_child_transform(GTK_FIXED(parent), widget_, t);
      gsk_transform_unref(t);
    }
  } else {
    // translate(layoutX, layoutY) ⊗ rn_matrix. GskTransform composes
    // on the right: gsk_transform_matrix(t, m) yields t · m, so the
    // final transform applied to a local point (px, py) is
    // translate · rn_matrix · point — exactly what RN expects.
    graphene_point_t pt = {layoutX_, layoutY_};
    GskTransform* t = gsk_transform_translate(nullptr, &pt);
    graphene_matrix_t mat;
    graphene_matrix_init_from_float(&mat, lastTransform_.data());
    t = gsk_transform_matrix(t, &mat);
    gtk_fixed_set_child_transform(GTK_FIXED(parent), widget_, t);
    gsk_transform_unref(t);
  }
  transformApplied_ = !isIdentity;
}

void ViewComponentView::applyBackgroundColor(unsigned int /*argb*/) {
  // Kept as a no-op for the header — the combined updateProps()
  // builds the full stylesheet now. (Header still references this
  // signature; removing it would force a recompile of nothing.)
}

void ViewComponentView::applyOpacity(float opacity) {
  if (!widget_)
    return;
  gtk_widget_set_opacity(widget_, opacity);
}

void ViewComponentView::applyBorderRadius(float /*tl*/, float /*tr*/, float /*br*/, float /*bl*/) {
  // Subsumed by updateProps(). Header retained until callers move.
}

} // namespace rnlinux
