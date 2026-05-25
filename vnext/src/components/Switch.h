// Minimal Linux Switch shadow node + props + descriptor.
//
// RN's stock Switch shadow nodes ship as platform-specific subtrees
// (androidswitch with its MeasurementsManager, plus a host-component
// path on iOS). To stay platform-neutral we declare our own
// SwitchProps over ViewProps and let the C++ component view back
// onto a GtkSwitch widget.
//
// Props we read:
//   * value         (bool) — RN's controlled on/off state
//   * disabled      (bool) — RN's "disabled" prop
//
// onValueChange is an outbound event; it doesn't sit on Props. The JS
// side registers the handler via rnLinux.fabricOnSwitchChange(tag, fn)
// and the GtkSwitch::notify::active signal dispatches into it.

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/propsConversions.h>

namespace rnlinux {

extern const char SwitchComponentName[];

class SwitchProps : public facebook::react::ViewProps {
 public:
  SwitchProps() = default;
  SwitchProps(const facebook::react::PropsParserContext& context,
              const SwitchProps& sourceProps,
              const facebook::react::RawProps& rawProps)
      : facebook::react::ViewProps(context, sourceProps, rawProps)
      , value(facebook::react::convertRawProp(context, rawProps, "value", sourceProps.value, false))
      , disabled(facebook::react::convertRawProp(
            context, rawProps, "disabled", sourceProps.disabled, false)) {}

  bool value{false};
  bool disabled{false};
};

class SwitchShadowNode final
    : public facebook::react::ConcreteViewShadowNode<SwitchComponentName,
                                                     SwitchProps,
                                                     facebook::react::ViewEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static facebook::react::ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(facebook::react::ShadowNodeTraits::Trait::LeafYogaNode);
    return traits;
  }
};

using SwitchComponentDescriptor = facebook::react::ConcreteComponentDescriptor<SwitchShadowNode>;

} // namespace rnlinux
