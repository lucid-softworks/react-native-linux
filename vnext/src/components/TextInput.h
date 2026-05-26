// Minimal Linux TextInput shadow node + descriptor.
//
// RN's stock TextInput shadow nodes are split per-platform
// (iostextinput / androidtextinput / …); each pulls in platform-
// specific extras (TextInputTraits etc.). For our MVP we register a
// cross-platform "TextInput" using BaseTextInputProps directly —
// that gives us placeholder / value / maxLength / placeholderTextColor
// out of the box, plus the ViewProps + BaseTextProps families.
//
// The class is a final ConcreteViewShadowNode, marked as a leaf with
// MeasurableYogaNode so Yoga lets the Linux component view declare
// its own measurement. (We measure via Pango on the C++ side.)

#pragma once

#include <react/renderer/components/textinput/BaseTextInputProps.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace rnlinux {

extern const char TextInputComponentName[];

class TextInputShadowNode final
    : public facebook::react::ConcreteViewShadowNode<TextInputComponentName,
                                                     facebook::react::BaseTextInputProps,
                                                     facebook::react::ViewEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static facebook::react::ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(facebook::react::ShadowNodeTraits::Trait::LeafYogaNode);
    return traits;
  }
};

using TextInputComponentDescriptor =
    facebook::react::ConcreteComponentDescriptor<TextInputShadowNode>;

} // namespace rnlinux
