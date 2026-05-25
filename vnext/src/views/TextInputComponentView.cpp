#include "TextInputComponentView.h"
#include "react-native-linux/Logging.h"
#include "../jsi/RnLinuxBindings.h"

#include <react/renderer/components/textinput/BaseTextInputProps.h>

#include <gtk/gtk.h>

#include <string>

namespace rnlinux {

TextInputComponentView::TextInputComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_text_new();
  // Connect the "changed" signal — fires after every character
  // typed / pasted / deleted. We dispatch text values to JS via
  // dispatchFabricChangeText(tag, text).
  g_signal_connect_data(
      widget_, "changed",
      G_CALLBACK(&TextInputComponentView::onTextChanged),
      this, /*destroy=*/nullptr, /*flags=*/static_cast<GConnectFlags>(0));
}

TextInputComponentView::~TextInputComponentView() = default;

void TextInputComponentView::onTextChanged(GtkWidget* editable,
                                            gpointer userData) {
  auto* self = static_cast<TextInputComponentView*>(userData);
  if (self->suppressChangeSignal_) return;
  const char* text = gtk_editable_get_text(GTK_EDITABLE(editable));
  if (!text) text = "";
  std::string s{text};
  if (s == self->lastText_) return;  // dedupe identical fires
  self->lastText_ = s;
  dispatchFabricChangeText(self->tag_, s);
}

void TextInputComponentView::updateProps(
    facebook::react::Props const& /*oldProps*/,
    facebook::react::Props const& newProps) {
  const auto& tp =
      static_cast<const facebook::react::BaseTextInputProps&>(newProps);

  // Placeholder text + colour (the latter via GtkText's
  // placeholder-text property — color is a separate concern).
  gtk_text_set_placeholder_text(GTK_TEXT(widget_), tp.placeholder.c_str());

  // maxLength: 0/unset means no limit. GtkText takes a positive int.
  gtk_text_set_max_length(GTK_TEXT(widget_),
                          tp.maxLength > 0 ? tp.maxLength : 0);

  // value: set only when the props differ from the current entry —
  // we suppress the signal during programmatic writes so we don't
  // bounce updates back to JS unnecessarily.
  const auto* current = gtk_editable_get_text(GTK_EDITABLE(widget_));
  std::string currentStr = current ? current : "";
  if (tp.text != currentStr) {
    suppressChangeSignal_ = true;
    gtk_editable_set_text(GTK_EDITABLE(widget_), tp.text.c_str());
    lastText_ = tp.text;
    suppressChangeSignal_ = false;
  }
}

}  // namespace rnlinux
