#include "HermesRuntimeFactory.h"
#include "react-native-linux/Logging.h"

#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include <exception>
#include <memory>

namespace rnlinux {

namespace {

class HermesRuntimeHolderImpl final : public HermesRuntimeHolder {
 public:
  HermesRuntimeHolderImpl() {
    // Default RuntimeConfig: small GC, no sampling profiler, no
    // crash manager. Tune later via env or RNLinuxHost::Config.
    auto config = ::hermes::vm::RuntimeConfig::Builder().build();
    runtime_ = facebook::hermes::makeHermesRuntime(config);
    RNL_LOGI("Hermes") << "runtime constructed";
  }

  bool evaluate(const std::string& source,
                const std::string& sourceUrl) override {
    if (!runtime_) {
      RNL_LOGE("Hermes") << "evaluate() called with null runtime";
      return false;
    }
    RNL_LOGI("Hermes") << "evaluate " << sourceUrl << " (" << source.size()
                       << " bytes)";
    try {
      // StringBuffer copies the source — the bundle bytes outlive the
      // buffer so we don't have to worry about lifetime here.
      auto buffer = std::make_shared<facebook::jsi::StringBuffer>(source);
      runtime_->evaluateJavaScript(buffer, sourceUrl);
      return true;
    } catch (const facebook::jsi::JSError& e) {
      RNL_LOGE("Hermes") << "JS error: " << e.getMessage()
                         << "\nstack:\n" << e.getStack();
      return false;
    } catch (const std::exception& e) {
      RNL_LOGE("Hermes") << "evaluate threw: " << e.what();
      return false;
    }
  }

  facebook::jsi::Runtime& runtime() override { return *runtime_; }

 private:
  std::unique_ptr<facebook::hermes::HermesRuntime> runtime_;
};

}  // namespace

std::unique_ptr<HermesRuntimeHolder> makeHermesRuntimeHolder() {
  return std::make_unique<HermesRuntimeHolderImpl>();
}

}  // namespace rnlinux
