#pragma once

#include <memory>
#include <string>

namespace facebook::jsi {
class Runtime;
}

namespace rnlinux {

// Opaque holder for the Hermes runtime. The header avoids pulling Hermes
// or JSI symbols into TUs that don't need them — internal code gets a
// `facebook::jsi::Runtime&` via `runtime()` and works against the JSI
// surface, never against Hermes-specific types.
class HermesRuntimeHolder {
 public:
  virtual ~HermesRuntimeHolder() = default;

  // Evaluate a JS source buffer (e.g. the Metro bundle). Returns false if
  // evaluation threw. The runtime stays alive after a throw; only the
  // half-evaluated state is discarded.
  virtual bool evaluate(const std::string& source, const std::string& sourceUrl) = 0;

  // Accessor for callers that need direct JSI access (Fabric scheduler,
  // TurboModule bindings, dev tools). Lifetime is tied to the holder.
  virtual facebook::jsi::Runtime& runtime() = 0;
};

std::unique_ptr<HermesRuntimeHolder> makeHermesRuntimeHolder();

// Construct just the runtime — used by JsThread which owns its own
// runtime instance and the construction must happen on the worker
// thread (Hermes binds the runtime to its constructor's pthread).
std::unique_ptr<facebook::jsi::Runtime> makeHermesRuntime();

} // namespace rnlinux
