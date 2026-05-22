#include "ViewComponentView.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>

#include <cstdio>
#include <string>

// When wired:
// #include <react/renderer/components/view/ViewProps.h>

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

void ViewComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                    facebook::react::Props const& /*newProps*/) {
  // TODO once headers are wired:
  //   const auto& vp = static_cast<react::ViewProps const&>(newProps);
  //   applyBackgroundColor(*vp.backgroundColor);
  //   applyOpacity(vp.opacity);
  //   applyBorderRadius(vp.borderRadii.topLeft, ...);
}

void ViewComponentView::applyBackgroundColor(unsigned int argb) {
  if (!cssProvider_) return;
  const unsigned a = (argb >> 24) & 0xff;
  const unsigned r = (argb >> 16) & 0xff;
  const unsigned g = (argb >> 8) & 0xff;
  const unsigned b = argb & 0xff;
  char css[128];
  std::snprintf(css, sizeof(css),
                "#%s { background-color: rgba(%u,%u,%u,%.3f); }",
                gtk_widget_get_name(widget_), r, g, b, a / 255.0);
  gtk_css_provider_load_from_string(static_cast<GtkCssProvider*>(cssProvider_),
                                    css);
}

void ViewComponentView::applyOpacity(float opacity) {
  gtk_widget_set_opacity(widget_, opacity);
}

void ViewComponentView::applyBorderRadius(float tl, float tr, float br, float bl) {
  if (!cssProvider_) return;
  char css[256];
  std::snprintf(css, sizeof(css),
                "#%s { border-radius: %.0fpx %.0fpx %.0fpx %.0fpx; }",
                gtk_widget_get_name(widget_), tl, tr, br, bl);
  gtk_css_provider_load_from_string(static_cast<GtkCssProvider*>(cssProvider_),
                                    css);
}

}  // namespace rnlinux
