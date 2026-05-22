#pragma once

#include <memory>

namespace rnlinux {

// Opaque holder for the Hermes runtime + JSI executor wrapper. The header
// avoids pulling Hermes/JSI symbols into TUs that don't need them.
class HermesRuntimeHolder {
 public:
  virtual ~HermesRuntimeHolder() = default;

  // Evaluate a JS source buffer (e.g. the Metro bundle) on the JS thread.
  // Returns true if evaluation started without throwing synchronously.
  virtual bool evaluate(const std::string& source, const std::string& sourceUrl) = 0;
};

std::unique_ptr<HermesRuntimeHolder> makeHermesRuntimeHolder();

}  // namespace rnlinux
