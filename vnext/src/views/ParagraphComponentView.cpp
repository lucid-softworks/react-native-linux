#include "ParagraphComponentView.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/attributedstring/primitives.h>
#include <react/renderer/components/text/ParagraphProps.h>
#include <react/renderer/components/text/ParagraphState.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/graphics/Color.h>

#include <gtk/gtk.h>

#include <cmath>
#include <cstdio>
#include <string>

namespace rnlinux {

namespace {

// Pango markup is XML-shaped: any literal text inside <span>…</span> has
// to escape the five special characters. We do not currently emit
// quotes/apostrophes inside element content, but escape them anyway —
// future fragments may legitimately contain "'" / "\"".
std::string escapeMarkup(const std::string& in) {
  std::string out;
  out.reserve(in.size());
  for (char c : in) {
    switch (c) {
      case '&':  out += "&amp;";  break;
      case '<':  out += "&lt;";   break;
      case '>':  out += "&gt;";   break;
      case '"':  out += "&quot;"; break;
      case '\'': out += "&apos;"; break;
      default:   out += c;        break;
    }
  }
  return out;
}

std::string spanAttrsFor(const facebook::react::TextAttributes& ta) {
  std::string attrs;

  if (ta.foregroundColor) {
    auto c = static_cast<unsigned int>(*ta.foregroundColor);
    char buf[40];
    std::snprintf(buf, sizeof(buf), " foreground=\"#%02x%02x%02x\"",
                  (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
    attrs += buf;
    // Pango doesn't honour the alpha channel on `foreground` — emit a
    // separate `alpha` attribute (0..65535) when not fully opaque.
    unsigned a = (c >> 24) & 0xff;
    if (a != 0xff) {
      std::snprintf(buf, sizeof(buf), " alpha=\"%u\"",
                    static_cast<unsigned>((a * 65535u + 127u) / 255u));
      attrs += buf;
    }
  }

  if (!std::isnan(ta.fontSize) && ta.fontSize > 0) {
    char buf[32];
    // Pango's font_size takes points; RN's fontSize is in CSS px but
    // the visual scale is close enough to pt for the playground.
    std::snprintf(buf, sizeof(buf), " font_size=\"%dpt\"",
                  static_cast<int>(ta.fontSize));
    attrs += buf;
  }

  if (!ta.fontFamily.empty()) {
    attrs += " font_family=\"" + escapeMarkup(ta.fontFamily) + "\"";
  }

  if (ta.fontWeight) {
    char buf[24];
    std::snprintf(buf, sizeof(buf), " weight=\"%d\"",
                  static_cast<int>(*ta.fontWeight));
    attrs += buf;
  }

  if (ta.fontStyle) {
    switch (*ta.fontStyle) {
      case facebook::react::FontStyle::Italic:
        attrs += " style=\"italic\""; break;
      case facebook::react::FontStyle::Oblique:
        attrs += " style=\"oblique\""; break;
      case facebook::react::FontStyle::Normal:
        break;
    }
  }

  return attrs;
}

std::string buildMarkup(
    const facebook::react::AttributedString& attributedString) {
  std::string markup;
  for (const auto& f : attributedString.getFragments()) {
    const auto escaped = escapeMarkup(f.string);
    const auto attrs = spanAttrsFor(f.textAttributes);
    if (attrs.empty()) {
      markup += escaped;
    } else {
      markup += "<span";
      markup += attrs;
      markup += ">";
      markup += escaped;
      markup += "</span>";
    }
  }
  return markup;
}

}  // namespace

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
  std::string markup = buildMarkup(paragraphState.attributedString);
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
