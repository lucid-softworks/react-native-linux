#include "LinuxComponentDescriptorRegistry.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/image/ImageComponentDescriptor.h>
#include <react/renderer/components/scrollview/ScrollViewComponentDescriptor.h>
#include <react/renderer/components/text/ParagraphComponentDescriptor.h>
#include <react/renderer/components/text/RawTextComponentDescriptor.h>
#include <react/renderer/components/text/TextComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>

#include "../components/TextInput.h"

namespace rnlinux {

namespace {
// Pull in the unqualified name from facebook::react in this TU only.
using facebook::react::ComponentDescriptorProviderRegistry;
using facebook::react::concreteComponentDescriptorProvider;
using facebook::react::ImageComponentDescriptor;
using facebook::react::ParagraphComponentDescriptor;
using facebook::react::RawTextComponentDescriptor;
using facebook::react::ScrollViewComponentDescriptor;
using facebook::react::TextComponentDescriptor;
using facebook::react::ViewComponentDescriptor;
}  // namespace

std::shared_ptr<ComponentDescriptorProviderRegistry>
makeLinuxComponentDescriptorRegistry() {
  auto registry = std::make_shared<ComponentDescriptorProviderRegistry>();
  registerCoreDescriptors(*registry);
  RNL_LOGI("ComponentDescriptorRegistry")
      << "registered core descriptors (View, Paragraph, RawText, Text, ScrollView, Image, TextInput)";
  return registry;
}

void registerCoreDescriptors(ComponentDescriptorProviderRegistry& registry) {
  // RN's core component set. Each `concreteComponentDescriptorProvider<T>()`
  // produces a `ComponentDescriptorProvider` carrying T's ShadowNode handle,
  // its component name, and a constructor stub. We deliberately don't
  // register the platform-specific (Image, ScrollView, …) descriptors here
  // — those come in Phase 9 once their LinuxComponentView subclasses exist.
  registry.add(concreteComponentDescriptorProvider<ViewComponentDescriptor>());
  registry.add(
      concreteComponentDescriptorProvider<ParagraphComponentDescriptor>());
  registry.add(
      concreteComponentDescriptorProvider<RawTextComponentDescriptor>());
  registry.add(concreteComponentDescriptorProvider<TextComponentDescriptor>());
  registry.add(
      concreteComponentDescriptorProvider<ScrollViewComponentDescriptor>());
  registry.add(concreteComponentDescriptorProvider<ImageComponentDescriptor>());
  // Our cross-platform TextInput shadow node (vnext/src/components/
  // TextInput.h) — uses BaseTextInputProps so placeholder, value,
  // maxLength, etc. all parse without any custom converter.
  registry.add(facebook::react::concreteComponentDescriptorProvider<
               TextInputComponentDescriptor>());
}

}  // namespace rnlinux
