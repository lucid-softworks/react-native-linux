#include "LinuxComponentDescriptorRegistry.h"
#include "react-native-linux/Logging.h"

// When the RN headers are wired:
// #include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
// #include <react/renderer/components/view/ViewComponentDescriptor.h>
// #include <react/renderer/components/text/ParagraphComponentDescriptor.h>
// #include <react/renderer/components/text/RawTextComponentDescriptor.h>
// #include <react/renderer/components/text/TextComponentDescriptor.h>

namespace rnlinux {

std::shared_ptr<facebook::react::ComponentDescriptorProviderRegistry>
makeLinuxComponentDescriptorRegistry() {
  RNL_LOGD("ComponentDescriptorRegistry") << "building registry (stub)";
  // TODO once headers compile:
  //   auto reg = std::make_shared<react::ComponentDescriptorProviderRegistry>();
  //   registerCoreDescriptors(*reg);
  //   return reg;
  return nullptr;
}

void registerCoreDescriptors(
    facebook::react::ComponentDescriptorProviderRegistry& /*registry*/) {
  // TODO:
  //   registry.add(react::concreteComponentDescriptorProvider<
  //                react::ViewComponentDescriptor>());
  //   registry.add(react::concreteComponentDescriptorProvider<
  //                react::ParagraphComponentDescriptor>());
  //   registry.add(react::concreteComponentDescriptorProvider<
  //                react::RawTextComponentDescriptor>());
  //   registry.add(react::concreteComponentDescriptorProvider<
  //                react::TextComponentDescriptor>());
}

}  // namespace rnlinux
