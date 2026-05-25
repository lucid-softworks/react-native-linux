#pragma once

// Minimal TurboModule registry — the C++ side of the
// `TurboModuleRegistry.get(name)` JS API. RN's JS-side
// TurboModuleRegistry.get just calls `globalThis.__turboModuleProxy(name)`;
// we install that proxy from installTurboModuleBinding() to look up a
// registered factory, lazy-construct the module on first access, and
// return it as a jsi::HostObject the JS proxy treats as a regular
// object (every method lookup goes through TurboModule::get).
//
// This replaces the ad-hoc `globalThis.rnLinux.*` JSI bindings as the
// shipping module surface. Existing rnLinux.* helpers stay alive
// today (animated, async storage, fabric click registries) and can
// migrate incrementally — the registry is opt-in per module.

#include <functional>
#include <jsi/jsi.h>
#include <memory>
#include <string>
#include <unordered_map>

namespace rnlinux {

// Base class for a Linux TurboModule. Subclasses override
// jsi::HostObject::get to expose methods (as jsi::Function host
// functions) and constants. JS-side library code looks them up by
// name through the host-object property accessor.
class TurboModule : public facebook::jsi::HostObject {
 public:
  ~TurboModule() override = default;
};

// Factory signature — called once per (runtime, name) pair to
// construct the module. Caching is done by the registry so subsequent
// `TurboModuleRegistry.get(name)` calls reuse the same instance.
using TurboModuleFactory = std::function<std::shared_ptr<TurboModule>(facebook::jsi::Runtime&)>;

class TurboModuleRegistry {
 public:
  // Process-wide singleton. Module registrations live for the
  // lifetime of the process. Module *instances* are cached per
  // runtime — see installTurboModuleBinding for the per-runtime
  // cache that gets cleared on reload.
  static TurboModuleRegistry& instance();

  // Register a factory under `name`. Last registration wins (later
  // modules of the same name shadow earlier ones).
  void registerModule(std::string name, TurboModuleFactory factory);

  // Look up a registered factory, or nullptr if no such name.
  const TurboModuleFactory* findFactory(const std::string& name) const;

 private:
  std::unordered_map<std::string, TurboModuleFactory> factories_;
};

// Install `globalThis.__turboModuleProxy` on the runtime. Called from
// the same install hook that wires up `rnLinux.*` (see
// RNLinuxApplication / RNLinuxHost::setBeforeBundleEvalHook).
void installTurboModuleBinding(facebook::jsi::Runtime& rt);

} // namespace rnlinux
