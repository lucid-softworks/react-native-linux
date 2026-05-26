// Minimal Linux Camera shadow node + props + descriptor.
//
// Upstream `expo-camera`'s CameraView ships a swath of props (facing,
// flash, zoom, ratio, focus, video options …). On Linux we accept the
// full surface at the JS layer but only `facing` flows into the
// native pipeline today — the rest are tracked as plain strings on
// the shadow node so a future iteration can react to them without a
// breaking prop-schema change.

#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/components/view/ViewEventEmitter.h>
#include <react/renderer/components/view/ViewProps.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/PropsParserContext.h>
#include <react/renderer/core/propsConversions.h>
#include <string>

namespace rnlinux {

extern const char CameraComponentName[];

class CameraProps : public facebook::react::ViewProps {
 public:
  CameraProps() = default;
  CameraProps(const facebook::react::PropsParserContext& context,
              const CameraProps& sourceProps,
              const facebook::react::RawProps& rawProps)
      : facebook::react::ViewProps(context, sourceProps, rawProps)
      , facing(facebook::react::convertRawProp(
            context, rawProps, "facing", sourceProps.facing, std::string("back"))) {}

  std::string facing{"back"};
};

class CameraShadowNode final
    : public facebook::react::ConcreteViewShadowNode<CameraComponentName,
                                                     CameraProps,
                                                     facebook::react::ViewEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  // No LeafYogaNode + no custom measureContent: CameraView behaves
  // like a regular container view, so style.flex / width / height
  // drive its size. We don't have a meaningful intrinsic size (frames
  // arrive asynchronously and the GtkPicture stretches to fit
  // whatever box it's given), so the natural fit is to let Yoga lay
  // it out exactly as the JS author specified.
};

using CameraComponentDescriptor = facebook::react::ConcreteComponentDescriptor<CameraShadowNode>;

} // namespace rnlinux
