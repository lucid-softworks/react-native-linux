#include "PangoMarkup.h"

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/TextAttributes.h>
#include <react/renderer/attributedstring/primitives.h>
#include <react/renderer/graphics/Color.h>

#include <cmath>
#include <cstdio>

namespace rnlinux::text {

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
  char buf[40];

  if (ta.foregroundColor) {
    auto c = static_cast<unsigned int>(*ta.foregroundColor);
    std::snprintf(buf, sizeof(buf), " foreground=\"#%02x%02x%02x\"",
                  (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
    attrs += buf;
    // Pango doesn't honour the alpha channel on `foreground` — emit
    // a separate `alpha` (0..65535) when not fully opaque.
    unsigned a = (c >> 24) & 0xff;
    if (a != 0xff) {
      std::snprintf(buf, sizeof(buf), " alpha=\"%u\"",
                    static_cast<unsigned>((a * 65535u + 127u) / 255u));
      attrs += buf;
    }
  }

  if (!std::isnan(ta.fontSize) && ta.fontSize > 0) {
    std::snprintf(buf, sizeof(buf), " font_size=\"%dpt\"",
                  static_cast<int>(ta.fontSize));
    attrs += buf;
  }

  if (!ta.fontFamily.empty()) {
    attrs += " font_family=\"" + escapeMarkup(ta.fontFamily) + "\"";
  }

  if (ta.fontWeight) {
    char wbuf[24];
    std::snprintf(wbuf, sizeof(wbuf), " weight=\"%d\"",
                  static_cast<int>(*ta.fontWeight));
    attrs += wbuf;
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

std::string buildMarkup(const facebook::react::AttributedString& s) {
  std::string markup;
  for (const auto& f : s.getFragments()) {
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

}  // namespace rnlinux::text
