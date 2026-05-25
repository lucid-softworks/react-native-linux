#include "HermesRuntimeFactory.h"

#include "react-native-linux/Logging.h"

#include <exception>
#include <hermes/hermes.h>
#include <jsi/jsi.h>
#include <memory>

namespace rnlinux {

namespace {

class HermesRuntimeHolderImpl final : public HermesRuntimeHolder {
 public:
  HermesRuntimeHolderImpl() {
    // withMicrotaskQueue(true) is what makes Promise.then / queueMicrotask
    // callbacks drain at JS-call boundaries. Without it, React's
    // post-commit work (passive effects scheduled via Promise.then) stays
    // in the queue forever because we don't have a JS-side event loop —
    // only entry-points from C++ drain it explicitly.
    auto config = ::hermes::vm::RuntimeConfig::Builder()
                      .withMicrotaskQueue(true)
                      // Default register pool is 128 KiB. Long-running
                      // Animated.loop chains (loop → sequence → timing,
                      // each recursing via cb({finished:true}) → next())
                      // eventually exhaust the register pool — that's
                      // the "Maximum call stack size exceeded" that
                      // kills the rAF chain after 1-10 s of running,
                      // which in turn is the source of the 30-60 FPS
                      // swings (with the loop dead there's no per-frame
                      // work). 16× the default — pool is purely memory,
                      // cost is tiny, animation chain runs effectively
                      // forever.
                      .withMaxNumRegisters(2 * 1024 * 1024)
                      .build();
    runtime_ = facebook::hermes::makeHermesRuntime(config);
    RNL_LOGI("Hermes") << "runtime constructed";
  }

  bool evaluate(const std::string& source, const std::string& sourceUrl) override {
    if (!runtime_) {
      RNL_LOGE("Hermes") << "evaluate() called with null runtime";
      return false;
    }
    RNL_LOGI("Hermes") << "evaluate " << sourceUrl << " (" << source.size() << " bytes)";
    try {
      // StringBuffer copies the source — the bundle bytes outlive the
      // buffer so we don't have to worry about lifetime here.
      auto buffer = std::make_shared<facebook::jsi::StringBuffer>(source);
      runtime_->evaluateJavaScript(buffer, sourceUrl);
      // Drain microtasks scheduled by the bundle (Promise.then chains
      // used by React's scheduler for passive effects, useEffect). Our
      // runtime has no JS-side event loop, so without this explicit
      // drain the queue sits forever until the next JS-from-C++ call.
      runtime_->drainMicrotasks();
      return true;
    } catch (const facebook::jsi::JSError& e) {
      RNL_LOGE("Hermes") << "JS error: " << e.getMessage() << "\nstack:\n" << e.getStack();
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

} // namespace

std::unique_ptr<HermesRuntimeHolder> makeHermesRuntimeHolder() {
  return std::make_unique<HermesRuntimeHolderImpl>();
}

} // namespace rnlinux
