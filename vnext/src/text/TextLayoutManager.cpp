// Pango-backed implementation of facebook::react::TextLayoutManager.
//
// Replaces RN's stock cxx variant
// (react-native/ReactCommon/.../platform/cxx/TextLayoutManager.cpp)
// which returns {0,0} for every measurement. Yoga uses the returned
// Size to give text nodes their intrinsic dimensions; without this,
// every <Text> ends up zero-height and siblings overlap.
//
// CMake (vnext/CMakeLists.txt) excludes the cxx file from the rn-
// renderer library glob so this one wins. The header
// (textlayoutmanager/platform/cxx/TextLayoutManager.h) is unchanged
// and ours implements its declared methods.

#include "PangoMarkup.h"

#include <cairo/cairo.h>
#include <pango/pangocairo.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>

namespace facebook::react {

void* TextLayoutManager::getNativeTextLayoutManager() const {
  return (void*)this;
}

TextMeasurement TextLayoutManager::measure(const AttributedStringBox& attributedStringBox,
                                           const ParagraphAttributes& paragraphAttributes,
                                           const TextLayoutContext& /*layoutContext*/,
                                           const LayoutConstraints& layoutConstraints) const {
  const auto& attributedString = attributedStringBox.getValue();

  TextMeasurement::Attachments attachments;
  for (const auto& fragment : attributedString.getFragments()) {
    if (fragment.isAttachment()) {
      // Inline attachments (Image, Pressable) need their own size
      // pass — Yoga reads the rect back to position the attached
      // child. Without measurement infrastructure for attachments
      // yet, emit zero-sized placeholders so the loop counts still
      // match.
      attachments.push_back(TextMeasurement::Attachment{{{0, 0}, {0, 0}}, false});
    }
  }

  if (attributedString.getFragments().empty()) {
    return TextMeasurement{{0, 0}, std::move(attachments)};
  }

  // Pango needs a PangoContext to build layouts. The Cairo font-map
  // backend gives us one tied to the system fontconfig setup — same
  // fonts GTK widgets use, so measurement matches what GtkLabel
  // ultimately renders. Contexts are cheap to create; we'd reuse if
  // the measure call became hot, but keeping it per-call dodges
  // thread-safety concerns (PangoLayout isn't shareable across
  // threads).
  PangoFontMap* fontMap = pango_cairo_font_map_get_default();
  PangoContext* ctx = pango_font_map_create_context(fontMap);
  PangoLayout* layout = pango_layout_new(ctx);

  const auto markup = rnlinux::text::buildMarkup(attributedString);
  pango_layout_set_markup(layout, markup.c_str(), -1);

  // Width constraint drives line wrap. PANGO_SCALE = 1024 (the
  // pango-pixel multiplier). Setting -1 means "infinite — single
  // line"; we use the caller's max width when finite.
  const auto maxW = layoutConstraints.maximumSize.width;
  if (maxW > 0 && std::isfinite(maxW)) {
    pango_layout_set_width(layout, static_cast<int>(maxW * PANGO_SCALE));
    pango_layout_set_wrap(layout, PANGO_WRAP_WORD_CHAR);
  } else {
    pango_layout_set_width(layout, -1);
  }

  // Honour numberOfLines — when set, Pango clips and (if requested)
  // ellipsizes at the tail.
  if (paragraphAttributes.maximumNumberOfLines > 0) {
    pango_layout_set_height(layout, -paragraphAttributes.maximumNumberOfLines);
    switch (paragraphAttributes.ellipsizeMode) {
    case EllipsizeMode::Head:
      pango_layout_set_ellipsize(layout, PANGO_ELLIPSIZE_START);
      break;
    case EllipsizeMode::Middle:
      pango_layout_set_ellipsize(layout, PANGO_ELLIPSIZE_MIDDLE);
      break;
    case EllipsizeMode::Tail:
      pango_layout_set_ellipsize(layout, PANGO_ELLIPSIZE_END);
      break;
    case EllipsizeMode::Clip:
    default:
      pango_layout_set_ellipsize(layout, PANGO_ELLIPSIZE_NONE);
      break;
    }
  }

  int w = 0, h = 0;
  pango_layout_get_pixel_size(layout, &w, &h);

  g_object_unref(layout);
  g_object_unref(ctx);

  // Clamp into the constraint window. Yoga later applies its own
  // bounds, but staying inside [min, max] here keeps the surface
  // measure consistent with the layout pass.
  auto width = static_cast<Float>(w);
  auto height = static_cast<Float>(h);
  width = std::max(width, layoutConstraints.minimumSize.width);
  height = std::max(height, layoutConstraints.minimumSize.height);
  if (std::isfinite(layoutConstraints.maximumSize.width)) {
    width = std::min(width, layoutConstraints.maximumSize.width);
  }
  if (std::isfinite(layoutConstraints.maximumSize.height)) {
    height = std::min(height, layoutConstraints.maximumSize.height);
  }

  return TextMeasurement{{width, height}, std::move(attachments)};
}

TextMeasurement TextLayoutManager::measureCachedSpannableById(
    int64_t /*cacheId*/,
    const ParagraphAttributes& /*paragraphAttributes*/,
    const LayoutConstraints& /*layoutConstraints*/) const {
  // We don't keep a measure cache yet — RN's only caller of this is
  // Android-side. Returning {} matches the stock cxx behaviour.
  return {};
}

LinesMeasurements
TextLayoutManager::measureLines(const AttributedStringBox& /*attributedStringBox*/,
                                const ParagraphAttributes& /*paragraphAttributes*/,
                                const Size& /*size*/) const {
  // Per-line metrics — used by accessibility / inline animations.
  // Stub for now; revisit when those features arrive.
  return {};
}

Float TextLayoutManager::baseline(const AttributedStringBox& /*attributedStringBox*/,
                                  const ParagraphAttributes& /*paragraphAttributes*/,
                                  const Size& /*size*/) const {
  return 0;
}

} // namespace facebook::react
