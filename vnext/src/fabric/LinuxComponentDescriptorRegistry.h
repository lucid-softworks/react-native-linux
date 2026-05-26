#pragma once

#include <memory>

namespace facebook::react {
class ComponentDescriptorProviderRegistry;
}

namespace rnlinux {

// Builds the set of Fabric ComponentDescriptors this platform knows about.
// React Native ships descriptors for View, Paragraph, RawText, Text, etc. in
// ReactCommon/react/renderer/components/{view,text}. We reuse those directly;
// platform-specific component views live under vnext/src/views/.
//
// To add a new core component:
//   1. Add the descriptor to registerCoreDescriptors below.
//   2. Add a LinuxComponentView subclass in src/views/.
//   3. Register the view factory with LinuxComponentViewRegistry.
std::shared_ptr<facebook::react::ComponentDescriptorProviderRegistry>
makeLinuxComponentDescriptorRegistry();

void registerCoreDescriptors(facebook::react::ComponentDescriptorProviderRegistry& registry);

} // namespace rnlinux
