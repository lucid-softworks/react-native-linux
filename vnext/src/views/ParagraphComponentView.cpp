#include "ParagraphComponentView.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/attributedstring/AttributedString.h>
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

  // Flatten every Fragment into one std::string. Once we support inline
  // colours/weights/fonts this becomes a PangoAttrList alongside the
  // text — but Pango's parsing of the markup form is enough for plain
  // mono-styled labels.
  std::string text = paragraphState.attributedString.getString();
  gtk_label_set_text(GTK_LABEL(widget_), text.c_str());
}

}  // namespace rnlinux
