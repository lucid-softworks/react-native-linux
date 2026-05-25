#include "TextInputComponentView.h"

#include "../jsi/RnLinuxBindings.h"
#include "react-native-linux/Logging.h"

#include <gdk/gdkkeysyms.h>
#include <gtk/gtk.h>
#include <react/renderer/components/textinput/BaseTextInputProps.h>
#include <string>

namespace rnlinux {

namespace {
// Map gdk keyval → RN onKeyPress `key` string. Special keys get RN
// names; printable ASCII rolls back to its single-character form.
const char* keyvalToRnKey(guint keyval) {
  switch (keyval) {
  case GDK_KEY_Return:
  case GDK_KEY_KP_Enter:
    return "Enter";
  case GDK_KEY_Tab:
    return "Tab";
  case GDK_KEY_BackSpace:
    return "Backspace";
  case GDK_KEY_Escape:
    return "Escape";
  case GDK_KEY_space:
    return " ";
  case GDK_KEY_Left:
    return "ArrowLeft";
  case GDK_KEY_Right:
    return "ArrowRight";
  case GDK_KEY_Up:
    return "ArrowUp";
  case GDK_KEY_Down:
    return "ArrowDown";
  case GDK_KEY_Home:
    return "Home";
  case GDK_KEY_End:
    return "End";
  case GDK_KEY_Delete:
    return "Delete";
  default:
    return nullptr;
  }
}

gboolean onKeyPressed(GtkEventControllerKey* /*controller*/,
                      guint keyval,
                      guint /*keycode*/,
                      GdkModifierType /*state*/,
                      gpointer userData) {
  auto* self = static_cast<TextInputComponentView*>(userData);
  std::string s;
  if (const char* named = keyvalToRnKey(keyval)) {
    s = named;
  } else {
    const guint32 c = gdk_keyval_to_unicode(keyval);
    if (c == 0)
      return FALSE;
    // UTF-8 encode the single code point.
    char buf[8] = {0};
    const gint n = g_unichar_to_utf8(c, buf);
    s.assign(buf, n);
  }
  dispatchFabricKeyPress(self->tag(), s);
  return FALSE; // don't swallow — let GtkText keep handling the key
}

void onActivate(GtkText* /*entry*/, gpointer userData) {
  auto* self = static_cast<TextInputComponentView*>(userData);
  dispatchFabricSubmitEditing(self->tag());
}
} // namespace

TextInputComponentView::TextInputComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_text_new();
  takeWidgetRef();
  // Connect the "changed" signal — fires after every character
  // typed / pasted / deleted. We dispatch text values to JS via
  // dispatchFabricChangeText(tag, text).
  g_signal_connect_data(widget_,
                        "changed",
                        G_CALLBACK(&TextInputComponentView::onTextChanged),
                        this,
                        /*destroy=*/nullptr,
                        /*flags=*/static_cast<GConnectFlags>(0));
  // GtkText emits "activate" when the user presses Enter — wire to
  // RN's onSubmitEditing.
  g_signal_connect_data(widget_,
                        "activate",
                        G_CALLBACK(&onActivate),
                        this,
                        /*destroy=*/nullptr,
                        /*flags=*/static_cast<GConnectFlags>(0));
  // GtkEventControllerKey lets us fire onKeyPress for every keystroke
  // before GtkText processes it. We pass through (return FALSE) so
  // editing isn't blocked.
  GtkEventController* keyCtl = gtk_event_controller_key_new();
  g_signal_connect_data(keyCtl,
                        "key-pressed",
                        G_CALLBACK(&onKeyPressed),
                        this,
                        /*destroy=*/nullptr,
                        /*flags=*/static_cast<GConnectFlags>(0));
  gtk_widget_add_controller(widget_, keyCtl);
}

TextInputComponentView::~TextInputComponentView() = default;

void TextInputComponentView::onTextChanged(GtkWidget* editable, gpointer userData) {
  auto* self = static_cast<TextInputComponentView*>(userData);
  if (self->suppressChangeSignal_)
    return;
  const char* text = gtk_editable_get_text(GTK_EDITABLE(editable));
  if (!text)
    text = "";
  std::string s{text};
  if (s == self->lastText_)
    return; // dedupe identical fires
  self->lastText_ = s;
  dispatchFabricChangeText(self->tag_, s);
}

void TextInputComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                         facebook::react::Props const& newProps) {
  const auto& tp = static_cast<const facebook::react::BaseTextInputProps&>(newProps);

  // Placeholder text + colour (the latter via GtkText's
  // placeholder-text property — color is a separate concern).
  gtk_text_set_placeholder_text(GTK_TEXT(widget_), tp.placeholder.c_str());

  // maxLength: 0/unset means no limit. GtkText takes a positive int.
  gtk_text_set_max_length(GTK_TEXT(widget_), tp.maxLength > 0 ? tp.maxLength : 0);

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

} // namespace rnlinux
