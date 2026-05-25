#include "ParagraphComponentView.h"
#include "react-native-linux/Logging.h"
#include "../text/PangoMarkup.h"

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/core/ConcreteState.h>

#include <gtk/gtk.h>

namespace rnlinux {

ParagraphComponentView::ParagraphComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_label_new("");
  gtk_label_set_wrap(GTK_LABEL(widget_), TRUE);
  gtk_label_set_xalign(GTK_LABEL(widget_), 0.0f);
  gtk_label_set_yalign(GTK_LABEL(widget_), 0.0f);
}

void ParagraphComponentView::updateProps(
    facebook::react::Props const& /*oldProps*/,
    facebook::react::Props const& /*newProps*/) {
  // ParagraphProps carries alignment / line-break behaviour. Defer to
  // when we render multi-fragment Pango attribute lists; for the MVP
  // the AttributedString in updateState carries everything visible.
}

void ParagraphComponentView::updateState(
    facebook::react::State const& state) {
  using ConcreteParagraphState =
      facebook::react::ConcreteState<facebook::react::ParagraphState>;
  // RN hands us the abstract base; downcast through the typed concrete
  // wrapper Fabric uses for ParagraphShadowNode.
  const auto& paragraphState =
      static_cast<const ConcreteParagraphState&>(state).getData();

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

}  // namespace rnlinux
