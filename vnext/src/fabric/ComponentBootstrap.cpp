#include "react-native-linux/ComponentBootstrap.h"

namespace rnlinux {

namespace {

std::vector<LinuxComponentBootstrap::Initializer>& state() {
  static std::vector<LinuxComponentBootstrap::Initializer> kInits;
  return kInits;
}

} // namespace

void LinuxComponentBootstrap::registerInitializer(Initializer init) {
  if (init)
    state().push_back(std::move(init));
}

void LinuxComponentBootstrap::applyAll(
    facebook::react::ComponentDescriptorProviderRegistry& registry) {
  for (const auto& init : state()) {
    if (init)
      init(registry);
  }
}

void LinuxComponentBootstrap::clear() {
  state().clear();
}

} // namespace rnlinux
