#pragma once

#include "../fabric/LinuxComponentView.h"

namespace rnlinux {

// Backed by a GtkLabel. RN's Paragraph holds an AttributedString assembled
// from one-or-more RawText fragments + optional inline Text styles. We
// flatten that into a PangoAttrList applied to the label.
class ParagraphComponentView final : public LinuxComponentView {
 public:
  explicit ParagraphComponentView(Tag tag);

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;
  void updateState(facebook::react::State const& state) override;
};

}  // namespace rnlinux
