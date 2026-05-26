#pragma once

#include <string>

namespace facebook::react {
class AttributedString;
class TextAttributes;
} // namespace facebook::react

namespace rnlinux::text {

// Pango markup is XML-shaped: any literal text inside <span>…</span> has
// to escape five characters. Public so callers needing a single
// pre-built attribute string (e.g. the text layout manager) can share
// the implementation.
std::string escapeMarkup(const std::string& in);

// Translate a fragment's TextAttributes into the contents of a Pango
// <span ...> tag — foreground, font_size, font_family, weight, style.
// Returns an empty string when no attribute is meaningful, so callers
// can collapse the <span> wrapper for unstyled fragments.
std::string spanAttrsFor(const facebook::react::TextAttributes& ta);

// Walks the AttributedString's fragments and emits a single Pango
// markup string. Shared between ParagraphComponentView (rendering)
// and the TextLayoutManager (measurement).
std::string buildMarkup(const facebook::react::AttributedString& s);

} // namespace rnlinux::text
