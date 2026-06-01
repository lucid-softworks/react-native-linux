#pragma once

// Public access to the host's RuntimeExecutor. Generated TurboModule
// headers and out-of-tree native modules pull this in so they can
// post jsi::Runtime work back to the JS thread without having to
// reach into vnext's internal `jsi/RnLinuxBindings.h`.
//
// Same signature as `facebook::react::RuntimeExecutor` — kept here
// as an alias so consumers don't have to drag the React renderer
// header into every translation unit.

#include <functional>

namespace facebook::jsi {
class Runtime;
}

namespace rnlinux {

using RuntimeExecutor = std::function<void(std::function<void(facebook::jsi::Runtime&)>&&)>;

// Returns the host's RuntimeExecutor. Empty (default-constructed)
// until `RNLinuxHost::start()` runs — callers must check
// `static_cast<bool>(getRuntimeExecutor())` before invoking.
//
// Generated TurboModule code captures the result at JSI-binding install
// time and uses it inside resolve/reject lambdas to hop back onto the
// JS thread before touching the runtime.
RuntimeExecutor getRuntimeExecutor();

} // namespace rnlinux
