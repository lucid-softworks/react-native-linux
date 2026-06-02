#pragma once

// Component-descriptor registration hub. Each generated component
// spec exposes a `installComponent()` static that adds an
// initializer here at TU load time; the host invokes
// `applyAll(registry)` from
// `makeLinuxComponentDescriptorRegistry()` after the core
// descriptor set is in place.
//
// Same idea as TurboModuleRegistry's process-wide singleton, but for
// Fabric components — the registry itself is per-host, so we
// accumulate registration *callbacks* at load time and apply them to
// whichever registry is being built.

#include <functional>
#include <vector>

namespace facebook::react {
class ComponentDescriptorProviderRegistry;
} // namespace facebook::react

namespace rnlinux {

class LinuxComponentBootstrap {
 public:
  using Initializer = std::function<void(facebook::react::ComponentDescriptorProviderRegistry&)>;

  // Add a callback that will register one or more component
  // descriptors on a registry. Called at load time from a
  // generated `installComponent()` slot.
  static void registerInitializer(Initializer init);

  // Apply every registered initializer to `registry` in
  // registration order. Idempotent — calling more than once just
  // re-adds the same descriptors (the underlying registry
  // deduplicates by component name).
  static void applyAll(facebook::react::ComponentDescriptorProviderRegistry& registry);

  // Used by tests / hot-reload paths to drop accumulated
  // initializers. Not normally called during the app lifecycle.
  static void clear();
};

} // namespace rnlinux
