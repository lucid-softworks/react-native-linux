#include "ParagraphComponentView.h"

#include "../text/PangoMarkup.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/core/ConcreteState.h>

namespace rnlinux {

ParagraphComponentView::ParagraphComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_label_new("");
  takeWidgetRef();
  gtk_label_set_wrap(GTK_LABEL(widget_), TRUE);
  gtk_label_set_xalign(GTK_LABEL(widget_), 0.0f);
  gtk_label_set_yalign(GTK_LABEL(widget_), 0.0f);
}

void ParagraphComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                         facebook::react::Props const& newProps) {
  const auto& paragraphProps = static_cast<const facebook::react::ParagraphProps&>(newProps);
  const auto& attrs = paragraphProps.paragraphAttributes;

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
