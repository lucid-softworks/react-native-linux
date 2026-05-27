#include "TextInputComponentView.h"

#include "../jsi/RnLinuxBindings.h"
#include "react-native-linux/Logging.h"

#include <cstdio>
#include <gdk/gdkkeysyms.h>
#include <gtk/gtk.h>
#include <react/renderer/components/iostextinput/TextInputProps.h>
#include <react/renderer/graphics/HostPlatformColor.h>
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
                      GdkModifierType state,
                      gpointer userData) {
  auto* self = static_cast<TextInputComponentView*>(userData);
  // GtkText doesn't ship default key bindings for Ctrl+A / Ctrl+C /
  // Ctrl+X / Ctrl+V — those live on the higher-level GtkEntry wrapper.
  // We use GtkText directly (for the placeholder/CSS hooks RN needs),
  // so we have to wire the standard editing accelerators ourselves.
  // Modifier check tolerates NumLock / CapsLock by masking to the
  // accelerator-relevant bits only.
  const auto mods = state & gtk_accelerator_get_default_mod_mask();
  if (mods == GDK_CONTROL_MASK) {
    GtkEditable* ed = GTK_EDITABLE(self->widget());
    switch (keyval) {
    case GDK_KEY_a:
    case GDK_KEY_A:
      gtk_editable_select_region(ed, 0, -1);
      return TRUE;
    case GDK_KEY_c:
    case GDK_KEY_C:
      g_signal_emit_by_name(ed, "copy-clipboard");
      return TRUE;
    case GDK_KEY_x:
    case GDK_KEY_X:
      g_signal_emit_by_name(ed, "cut-clipboard");
      return TRUE;
    case GDK_KEY_v:
    case GDK_KEY_V:
      g_signal_emit_by_name(ed, "paste-clipboard");
      return TRUE;
    default:
      break;
    }
  }
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
  // Per-instance CSS provider — targets a unique name so each entry
  // can have its own placeholder-color rule (Paper sets the active
  // input's placeholder to 'transparent' while the inactive ones use
  // the theme default).
  std::string cssName = "rnl-input-" + std::to_string(tag);
  gtk_widget_set_name(widget_, cssName.c_str());
  auto* provider = gtk_css_provider_new();
  cssProvider_ = provider;
  gtk_style_context_add_provider_for_display(gtk_widget_get_display(widget_),
                                             GTK_STYLE_PROVIDER(provider),
                                             GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
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
  // GtkEventControllerFocus → RN onFocus / onBlur. Paper's
  // TextInput.Outlined drives its floating-label animation off
  // these — without them the label stays inline and the user's
  // typed text overlays it.
  GtkEventController* focusCtl = gtk_event_controller_focus_new();
  g_signal_connect_data(focusCtl,
                        "enter",
                        G_CALLBACK(+[](GtkEventControllerFocus*, gpointer ud) {
                          dispatchFabricFocus(static_cast<TextInputComponentView*>(ud)->tag());
                        }),
                        this,
                        nullptr,
                        static_cast<GConnectFlags>(0));
  g_signal_connect_data(focusCtl,
                        "leave",
                        G_CALLBACK(+[](GtkEventControllerFocus*, gpointer ud) {
                          dispatchFabricBlur(static_cast<TextInputComponentView*>(ud)->tag());
                        }),
                        this,
                        nullptr,
                        static_cast<GConnectFlags>(0));
  gtk_widget_add_controller(widget_, focusCtl);

  // GtkEventControllerKey lets us fire onKeyPress for every keystroke
  // before GtkText processes it. We pass through (return FALSE) so
  // editing isn't blocked.
  //
  // CRITICAL: phase MUST be CAPTURE, not the default BUBBLE. GtkText
  // consumes printable-character key-presses internally (inserting
  // the glyph and returning TRUE), so a BUBBLE-phase controller never
  // sees them — including Ctrl+A / Ctrl+C / Ctrl+V (GtkText is the
  // raw text widget; the standard editing accelerators live on the
  // higher-level GtkEntry wrapper, which we don't use). Capture
  // intercepts the event on its way DOWN to GtkText so we can
  // honour Ctrl+A select-all (and forward onKeyPress to JS) before
  // GtkText decides to swallow the event.
  GtkEventController* keyCtl = gtk_event_controller_key_new();
  gtk_event_controller_set_propagation_phase(keyCtl, GTK_PHASE_CAPTURE);
  g_signal_connect_data(keyCtl,
                        "key-pressed",
                        G_CALLBACK(&onKeyPressed),
                        this,
                        /*destroy=*/nullptr,
                        /*flags=*/static_cast<GConnectFlags>(0));
  gtk_widget_add_controller(widget_, keyCtl);
}

TextInputComponentView::~TextInputComponentView() {
  if (dispatchIdleId_ != 0) {
    g_source_remove(dispatchIdleId_);
    dispatchIdleId_ = 0;
  }
  if (cssProvider_) {
    g_object_unref(static_cast<GtkCssProvider*>(cssProvider_));
  }
}

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
  // Defer the JS dispatch via g_idle_add so the keystroke paints
  // BEFORE the synchronous React commit chain runs. GtkText has
  // already inserted the glyph by the time `changed` fires; we don't
  // need to block its next-frame paint waiting for the full
  // reconciler pass for the affected subtree.
  //
  // Single coalesced idle source per tag — when it fires it reads
  // the LATEST `lastText_`, so a burst of keystrokes ships one
  // dispatch per main-loop turn instead of one-per-key. The
  // controlled-input echo race is closed by tracking
  // lastDispatched_ and rejecting matching writes in updateProps.
  if (self->dispatchIdleId_ == 0) {
    self->dispatchIdleId_ = g_idle_add(
        +[](gpointer ud) -> gboolean {
          auto* self2 = static_cast<TextInputComponentView*>(ud);
          self2->dispatchIdleId_ = 0;
          self2->lastDispatched_ = self2->lastText_;
          dispatchFabricChangeText(self2->tag_, self2->lastDispatched_);
          return G_SOURCE_REMOVE;
        },
        self);
  }
}

void TextInputComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                         facebook::react::Props const& newProps) {
  const auto& tp = static_cast<const facebook::react::TextInputProps&>(newProps);

  // Placeholder text + colour. GtkText draws the placeholder via a
  // child "placeholder" CSS node — we style it with a per-widget
  // stylesheet rather than setting empty text when the colour is
  // transparent, so Paper's animated cross-fade (alpha → 0 then back
  // to opaque) still has something to fade against.
  gtk_text_set_placeholder_text(GTK_TEXT(widget_), tp.placeholder.c_str());

  std::string css;
  if (tp.placeholderTextColor) {
    const auto v = static_cast<unsigned int>(*tp.placeholderTextColor);
    char buf[120];
    std::snprintf(buf,
                  sizeof(buf),
                  "#%s > placeholder { color: rgba(%u,%u,%u,%.3f); opacity: %.3f; }",
                  gtk_widget_get_name(widget_),
                  (v >> 16) & 0xff,
                  (v >> 8) & 0xff,
                  v & 0xff,
                  ((v >> 24) & 0xff) / 255.0,
                  ((v >> 24) & 0xff) / 255.0);
    css = buf;
  }
  if (css != lastCss_) {
    gtk_css_provider_load_from_string(static_cast<GtkCssProvider*>(cssProvider_), css.c_str());
    lastCss_ = std::move(css);
  }

  // maxLength: 0/unset means no limit. GtkText takes a positive int.
  gtk_text_set_max_length(GTK_TEXT(widget_), tp.maxLength > 0 ? tp.maxLength : 0);

  // secureTextEntry lives on TextInputProps.traits. GtkText draws the
  // masked-character glyph (•) when visibility is off, matching the
  // iOS/Android contract for password fields.
  gtk_text_set_visibility(GTK_TEXT(widget_), tp.traits.secureTextEntry ? FALSE : TRUE);

  // value: set only when the props differ from the current entry and
  // the incoming value isn't just JS echoing back the LAST value we
  // dispatched. Because the changed-signal dispatch is now coalesced
  // via g_idle_add, the user can keep typing after we've handed off
  // "abc" to JS; once React's commit catches up with tp.text="abc",
  // GtkText might already hold "abcd". Without the lastDispatched_
  // guard we'd treat that re-arrival as a programmatic write and
  // clobber the "d" the user just typed.
  const auto* current = gtk_editable_get_text(GTK_EDITABLE(widget_));
  std::string currentStr = current ? current : "";
  if (tp.text != currentStr && tp.text != lastDispatched_) {
    suppressChangeSignal_ = true;
    gtk_editable_set_text(GTK_EDITABLE(widget_), tp.text.c_str());
    lastText_ = tp.text;
    lastDispatched_ = tp.text;
    suppressChangeSignal_ = false;
  }
}

} // namespace rnlinux
