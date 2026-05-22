#include "ParagraphComponentView.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>

// When wired:
// #include <react/renderer/components/text/ParagraphProps.h>
// #include <react/renderer/components/text/ParagraphState.h>
// #include <react/renderer/attributedstring/AttributedString.h>

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
  // TODO: pull text alignment, color, etc. from ParagraphProps.
}

void ParagraphComponentView::updateState(
    facebook::react::State const& /*state*/) {
  // RN's ParagraphState carries the merged AttributedString + LayoutManager.
  // The concrete steps:
  //   const auto& ps = static_cast<react::ParagraphState const&>(state);
  //   const auto& as = ps.attributedString;
  //   std::string text;
  //   PangoAttrList* attrs = pango_attr_list_new();
  //   size_t offset = 0;
  //   for (const auto& fragment : as.getFragments()) {
  //     text += fragment.string;
  //     applyTextAttributes(attrs, fragment.textAttributes,
  //                         offset, offset + fragment.string.size());
  //     offset += fragment.string.size();
  //   }
  //   gtk_label_set_text(GTK_LABEL(widget_), text.c_str());
  //   gtk_label_set_attributes(GTK_LABEL(widget_), attrs);
  //   pango_attr_list_unref(attrs);
  RNL_LOGD("Paragraph") << "updateState (stub)";
}

}  // namespace rnlinux
