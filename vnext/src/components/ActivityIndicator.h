// Minimal Linux ActivityIndicator shadow node + props + descriptor.
//
// RN's stock ActivityIndicator is a thin platform wrapper (RAC iOS
// spinner / Android ProgressBar); both are codegen-generated and not
// available as source files. We declare our own cross-platform props
// (animating, hidesWhenStopped, color, size) and let
// ActivityIndicatorComponentView back it with a GtkSpinner.

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/propsConversions.h>

namespace rnlinux {

extern const char ActivityIndicatorComponentName[];

class ActivityIndicatorProps : public facebook::react::ViewProps {
 public:
  ActivityIndicatorProps() = default;
  ActivityIndicatorProps(const facebook::react::PropsParserContext& context,
                         const ActivityIndicatorProps& sourceProps,
                         const facebook::react::RawProps& rawProps)
      : facebook::react::ViewProps(context, sourceProps, rawProps)
      , animating(facebook::react::convertRawProp(
            context, rawProps, "animating", sourceProps.animating, true))
      , hidesWhenStopped(facebook::react::convertRawProp(
            context, rawProps, "hidesWhenStopped", sourceProps.hidesWhenStopped, true)) {}

  bool animating{true};
  bool hidesWhenStopped{true};
};

class ActivityIndicatorShadowNode final
    : public facebook::react::ConcreteViewShadowNode<ActivityIndicatorComponentName,
                                                     ActivityIndicatorProps,
                                                     facebook::react::ViewEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  static facebook::react::ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(facebook::react::ShadowNodeTraits::Trait::LeafYogaNode);
    return traits;
  }
};

using ActivityIndicatorComponentDescriptor =
    facebook::react::ConcreteComponentDescriptor<ActivityIndicatorShadowNode>;

} // namespace rnlinux
