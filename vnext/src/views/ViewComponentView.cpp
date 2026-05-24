#include "ViewComponentView.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/graphics/Color.h>
#include <react/renderer/graphics/HostPlatformColor.h>

#include <gtk/gtk.h>

#include <cstdio>
#include <string>

namespace rnlinux {

ViewComponentView::ViewComponentView(Tag tag) : LinuxComponentView(tag) {
  widget_ = gtk_fixed_new();
  // Tag every widget with a unique CSS name so per-instance style rules
  // (background, border) can target it without affecting siblings.
  std::string cssName = "rnl-view-" + std::to_string(tag);
  gtk_widget_set_name(widget_, cssName.c_str());

  auto* provider = gtk_css_provider_new();
  cssProvider_ = provider;
  gtk_style_context_add_provider_for_display(
      gtk_widget_get_display(widget_),
      GTK_STYLE_PROVIDER(provider),
      GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
}

ViewComponentView::~ViewComponentView() {
  if (cssProvider_) {
    g_object_unref(static_cast<GtkCssProvider*>(cssProvider_));
  }
}

void ViewComponentView::updateProps(
    facebook::react::Props const& oldProps,
    facebook::react::Props const& newProps) {
  const auto& oldVP = static_cast<const facebook::react::ViewProps&>(oldProps);
  const auto& newVP = static_cast<const facebook::react::ViewProps&>(newProps);

  if (oldVP.backgroundColor != newVP.backgroundColor) {
    if (newVP.backgroundColor) {
      applyBackgroundColor(static_cast<unsigned int>(*newVP.backgroundColor));
    } else {
      // Clear the per-widget CSS so the background resets to GTK default.
      gtk_css_provider_load_from_string(
          static_cast<GtkCssProvider*>(cssProvider_), "");
    }
  }
  if (oldVP.opacity != newVP.opacity) {
    applyOpacity(static_cast<float>(newVP.opacity));
  }
  // Border-radius live in BorderRadii — we read the top-level (single
  // value) for the MVP; per-corner support comes once corner-specific
  // CSS templates exist.
  const auto br = newVP.borderRadii.all.value_or(facebook::react::ValueUnit{});
  applyBorderRadius(br.value, br.value, br.value, br.value);
}

void ViewComponentView::applyBackgroundColor(unsigned int argb) {
  if (!cssProvider_) return;
  // RN packs colors as (A << 24) | (R << 16) | (G << 8) | B (see
  // HostPlatformColor.h). Convert to CSS rgba().
  const unsigned a = (argb >> 24) & 0xff;
  const unsigned r = (argb >> 16) & 0xff;
  const unsigned g = (argb >> 8) & 0xff;
  const unsigned b = argb & 0xff;
  char css[160];
  std::snprintf(css, sizeof(css),
                "#%s { background-color: rgba(%u,%u,%u,%.3f); }",
                gtk_widget_get_name(widget_), r, g, b, a / 255.0);
  gtk_css_provider_load_from_string(
      static_cast<GtkCssProvider*>(cssProvider_), css);
}

void ViewComponentView::applyOpacity(float opacity) {
  if (!widget_) return;
  gtk_widget_set_opacity(widget_, opacity);
}

void ViewComponentView::applyBorderRadius(float tl, float tr, float br,
                                           float bl) {
  if (!cssProvider_) return;
  if (tl == 0 && tr == 0 && br == 0 && bl == 0) return;  // skip empty
  char css[256];
  std::snprintf(css, sizeof(css),
                "#%s { border-radius: %.0fpx %.0fpx %.0fpx %.0fpx; }",
                gtk_widget_get_name(widget_), tl, tr, br, bl);
  // load_from_string replaces — but we'd lose backgroundColor. For now
  // applyBackgroundColor is the dominant style; revisit when we want
  // both at once (combine into a single CSS string per widget).
  gtk_css_provider_load_from_string(
      static_cast<GtkCssProvider*>(cssProvider_), css);
}

}  // namespace rnlinux
