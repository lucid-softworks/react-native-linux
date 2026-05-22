#include "HermesRuntimeFactory.h"
#include "react-native-linux/Logging.h"

// Hermes JSI runtime headers. These come from the Hermes::Hermes target
// fetched by FetchHermes.cmake.
//
// #include <hermes/hermes.h>
//
// Real implementation pseudocode:
//
//   auto config = hermes::vm::RuntimeConfig::Builder().build();
//   auto runtime = facebook::hermes::makeHermesRuntime(config);
//   runtime->evaluateJavaScript(buffer, sourceUrl);

namespace rnlinux {

namespace {

class HermesRuntimeHolderImpl final : public HermesRuntimeHolder {
 public:
  HermesRuntimeHolderImpl() {
    RNL_LOGD("Hermes") << "HermesRuntimeHolder created (stub)";
    // TODO: runtime_ = facebook::hermes::makeHermesRuntime(...);
  }

  bool evaluate(const std::string& source, const std::string& sourceUrl) override {
    RNL_LOGI("Hermes") << "evaluate(" << sourceUrl << ", " << source.size()
                        << " bytes) — stub";
    // TODO: runtime_->evaluateJavaScript(std::make_shared<StringBuffer>(source), sourceUrl);
    return true;
  }
};

}  // namespace

std::unique_ptr<HermesRuntimeHolder> makeHermesRuntimeHolder() {
  return std::make_unique<HermesRuntimeHolderImpl>();
}

}  // namespace rnlinux
