// Minimal Linux TextInput shadow node + descriptor.
//
// RN's stock TextInput shadow nodes are split per-platform
// (iostextinput / androidtextinput / …). We use the iOS-flavoured
// TextInputProps as our parameterisation: it bundles
// BaseTextInputProps (placeholder / value / maxLength /
// placeholderTextColor) with a TextInputTraits struct that includes
// `secureTextEntry`, `keyboardType`, `autoCorrect`,
// `enablesReturnKeyAutomatically`, etc. Going through TextInputProps
// lets RN's stock RawProps parser populate these from JS — otherwise
// we'd have to write a custom converter per prop.
//
// The class is a final ConcreteViewShadowNode, marked as a leaf with
// MeasurableYogaNode so Yoga lets the Linux component view declare
// its own measurement. (We measure via Pango on the C++ side.)

#pragma once

#include <react/renderer/components/iostextinput/TextInputProps.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>

namespace rnlinux {

extern const char TextInputComponentName[];

class TextInputShadowNode final
    : public facebook::react::ConcreteViewShadowNode<TextInputComponentName,
                                                     facebook::react::TextInputProps,
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
