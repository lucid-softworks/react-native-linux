#include "ParagraphComponentView.h"

#include "../jsi/RnLinuxBindings.h"
#include "../text/PangoMarkup.h"
#include "react-native-linux/Logging.h"

#include <cstdio>
#include <gtk/gtk.h>
#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <string>

namespace rnlinux {

ParagraphComponentView::ParagraphComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_label_new("");
  takeWidgetRef();
  gtk_label_set_wrap(GTK_LABEL(widget_), TRUE);
  gtk_label_set_xalign(GTK_LABEL(widget_), 0.0f);
  gtk_label_set_yalign(GTK_LABEL(widget_), 0.0f);
  // Per-instance CSS provider so each label can carry its own padding
  // rule (Yoga-computed contentInsets pushed into the GtkLabel below).
  std::string cssName = "rnl-label-" + std::to_string(tag);
  gtk_widget_set_name(widget_, cssName.c_str());
  auto* provider = gtk_css_provider_new();
  cssProvider_ = provider;
  gtk_style_context_add_provider_for_display(gtk_widget_get_display(widget_),
                                             GTK_STYLE_PROVIDER(provider),
                                             GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
}

ParagraphComponentView::~ParagraphComponentView() {
  if (!lastNativeId_.empty())
    unregisterAnimWidget(lastNativeId_);
  if (cssProvider_)
    g_object_unref(static_cast<GtkCssProvider*>(cssProvider_));
}

void ParagraphComponentView::updateLayoutMetrics(facebook::react::LayoutMetrics const& metrics) {
  LinuxComponentView::updateLayoutMetrics(metrics);
  // Push Yoga's contentInsets (border + padding) into the GtkLabel as
  // CSS padding. Without this, paddingHorizontal on a <Text> style
  // inflates the Yoga frame by 2×padding but the text inside still
  // hugs the widget's left edge — and Paper's outlined-input label
  // (which rides an Animated.View translateX of ~-14) renders past
  // the left edge of its overflow:hidden wrapper.
  const auto& ci = metrics.contentInsets;
  char buf[160];
  std::snprintf(buf,
                sizeof(buf),
                "#%s { padding: %.2fpx %.2fpx %.2fpx %.2fpx; }",
                gtk_widget_get_name(widget_),
                ci.top,
                ci.right,
                ci.bottom,
                ci.left);
  std::string css = buf;
  if (css != lastCss_) {
    gtk_css_provider_load_from_string(static_cast<GtkCssProvider*>(cssProvider_), css.c_str());
    lastCss_ = std::move(css);
  }
}

void ParagraphComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                         facebook::react::Props const& newProps) {
  const auto& paragraphProps = static_cast<const facebook::react::ParagraphProps&>(newProps);
  const auto& attrs = paragraphProps.paragraphAttributes;

  // Sync nativeID into the global Animated lookup so setNativeProp can
  // address this label by its Animated host's id. Paper wraps its
  // floating-label text in Animated.Text and rides translateY / scale
  // off the same `labeled` driver as the outer Animated.View — without
  // this the text stays at its initial scale/position and only the
  // outer wrapper's translateX takes effect.
  if (paragraphProps.nativeId != lastNativeId_) {
    if (!lastNativeId_.empty())
      unregisterAnimWidget(lastNativeId_);
    if (!paragraphProps.nativeId.empty())
      registerAnimWidget(paragraphProps.nativeId, widget_);
    lastNativeId_ = paragraphProps.nativeId;
  }

  // RN's `numberOfLines` lands here as `maximumNumberOfLines`. 0 means
  // "no limit" in the data model; GtkLabel uses -1 for that. We always
  // set the value (rather than only on change) so the prop's absence
  // after a clearing prop change resets the label.
  const int maxLines = attrs.maximumNumberOfLines > 0 ? attrs.maximumNumberOfLines : -1;
  gtk_label_set_lines(GTK_LABEL(widget_), maxLines);

  // ellipsizeMode → PangoEllipsizeMode. RN's Clip → no ellipsis at all
  // (Pango just truncates at the wrap boundary); the rest map 1:1.
  PangoEllipsizeMode pem = PANGO_ELLIPSIZE_NONE;
  switch (attrs.ellipsizeMode) {
  case facebook::react::EllipsizeMode::Head:
    pem = PANGO_ELLIPSIZE_START;
    break;
  case facebook::react::EllipsizeMode::Middle:
    pem = PANGO_ELLIPSIZE_MIDDLE;
    break;
  case facebook::react::EllipsizeMode::Tail:
    pem = PANGO_ELLIPSIZE_END;
    break;
  case facebook::react::EllipsizeMode::Clip:
  default:
    pem = PANGO_ELLIPSIZE_NONE;
    break;
  }
  gtk_label_set_ellipsize(GTK_LABEL(widget_), pem);

  // GtkLabel's ellipsize only fires when the label has a bounded width
  // AND wrap is off in single-line mode. Multi-line ellipsize at the
  // end of the last visible line requires set_lines() > 0 AND wrap on,
  // which we already configure in the constructor. For
  // numberOfLines={1} + ellipsizeMode='tail' (the canonical "fade out
  // long single-line text" RN pattern), disabling wrap gives the right
  // visual — Pango ellipsizes the single line at the bound.
  if (maxLines == 1 && pem != PANGO_ELLIPSIZE_NONE) {
    gtk_label_set_wrap(GTK_LABEL(widget_), FALSE);
  } else {
    gtk_label_set_wrap(GTK_LABEL(widget_), TRUE);
  }
}

void ParagraphComponentView::updateState(facebook::react::State const& state) {
  using ConcreteParagraphState = facebook::react::ConcreteState<facebook::react::ParagraphState>;
  // RN hands us the abstract base; downcast through the typed concrete
  // wrapper Fabric uses for ParagraphShadowNode.
  const auto& paragraphState = static_cast<const ConcreteParagraphState&>(state).getData();

  // Walk the AttributedString's fragments. Each fragment carries its
  // own TextAttributes (foregroundColor, fontSize, fontFamily, …) —
  // emit a <span> with the matching Pango attributes and let GtkLabel
  // do the rendering. Fragments without styling collapse into bare
  // (escaped) text.
  std::string markup = text::buildMarkup(paragraphState.attributedString);
  RNL_LOGI("Paragraph") << "updateState fragments="
                        << paragraphState.attributedString.getFragments().size() << " markup=\""
                        << markup << "\"";
  gtk_label_set_markup(GTK_LABEL(widget_), markup.c_str());

  // Horizontal alignment lives in the AttributedString's first
  // fragment's TextAttributes (RN funnels Text-style props there).
  // gtk_label_set_xalign maps to 0.0 / 0.5 / 1.0 for left/center/right.
  const auto& fragments = paragraphState.attributedString.getFragments();
  if (!fragments.empty() && fragments.front().textAttributes.alignment) {
    switch (*fragments.front().textAttributes.alignment) {
    case facebook::react::TextAlignment::Center:
      gtk_label_set_xalign(GTK_LABEL(widget_), 0.5f);
      break;
    case facebook::react::TextAlignment::Right:
      gtk_label_set_xalign(GTK_LABEL(widget_), 1.0f);
      break;
    case facebook::react::TextAlignment::Justified:
      gtk_label_set_justify(GTK_LABEL(widget_), GTK_JUSTIFY_FILL);
      // Pango still needs an xalign for the unfilled tail line.
      gtk_label_set_xalign(GTK_LABEL(widget_), 0.0f);
      break;
    case facebook::react::TextAlignment::Natural:
    case facebook::react::TextAlignment::Left:
    default:
      gtk_label_set_xalign(GTK_LABEL(widget_), 0.0f);
      break;
    }
  }
}

} // namespace rnlinux
