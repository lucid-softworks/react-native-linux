#include "react-native-linux/RNLinuxHost.h"
#include "react-native-linux/Logging.h"

#include "fabric/LinuxComponentDescriptorRegistry.h"
#include "fabric/LinuxMountingManager.h"
#include "fabric/LinuxSchedulerDelegate.h"
#include "jsi/BundleLoader.h"
#include "jsi/HermesRuntimeFactory.h"

#include <atomic>
#include <memory>
#include <thread>

namespace rnlinux {

struct RNLinuxHost::Impl {
  std::shared_ptr<LinuxMountingManager> mountingManager;
  std::unique_ptr<LinuxSchedulerDelegate> schedulerDelegate;
  std::unique_ptr<HermesRuntimeHolder> runtimeHolder;
  std::thread jsThread;
  std::atomic<bool> running{false};

  // TODO: store facebook::react::Scheduler + ReactInstance once Fabric headers
  // are wired in. Keeping them as opaque unique_ptrs for now to avoid pulling
  // RN headers into the public interface.
};

RNLinuxHost::RNLinuxHost(Config config)
    : impl_(std::make_unique<Impl>()), config_(std::move(config)) {}

RNLinuxHost::~RNLinuxHost() {
  stop();
}

void RNLinuxHost::start() {
  if (impl_->running.exchange(true)) {
    return;
  }
  RNL_LOGI("RNLinuxHost") << "starting (bundle=" << config_.bundleUrl << ")";

  // 1. Create the Hermes runtime + JSI executor.
  impl_->runtimeHolder = makeHermesRuntimeHolder();

  // 2. Spawn the JS thread.
  //    TODO: replace with folly::Executor + react::RuntimeExecutor.
  impl_->jsThread = std::thread([this] {
    RNL_LOGD("RNLinuxHost") << "js thread started";
    // The real implementation drives the runtime's message queue here.
  });

  // 3. Load the bundle on the JS thread.
  //    TODO: BundleLoader::loadFromUrl(config_.bundleUrl, ...) then evaluate
  //    in the Hermes runtime via JSIExecutor::loadBundle.
  loadBundle(config_.bundleUrl, [](BundleLoadResult res) {
    if (res.ok) {
      RNL_LOGI("RNLinuxHost") << "bundle loaded (" << res.bytes.size() << " bytes)";
    } else {
      RNL_LOGE("RNLinuxHost") << "bundle load failed: " << res.error;
    }
  });

  // 4. Construct Fabric Scheduler with the LinuxComponentDescriptorRegistry
  //    and our SchedulerDelegate.
  //    TODO once headers are wired:
  //      auto toolbox = react::SchedulerToolbox{...};
  //      scheduler_ = std::make_shared<react::Scheduler>(toolbox, ..., delegate_.get());
  impl_->schedulerDelegate =
      std::make_unique<LinuxSchedulerDelegate>(impl_->mountingManager);
}

void RNLinuxHost::stop() {
  if (!impl_->running.exchange(false)) {
    return;
  }
  RNL_LOGI("RNLinuxHost") << "stopping";

  // TODO: scheduler_->stopSurface for each, then destroy scheduler before the
  // runtime to ensure JSI references are released in the right order.
  if (impl_->jsThread.joinable()) {
    impl_->jsThread.join();
  }
  impl_->schedulerDelegate.reset();
  impl_->runtimeHolder.reset();
}

void RNLinuxHost::reload() {
  RNL_LOGI("RNLinuxHost") << "reload requested";
  stop();
  start();
}

void RNLinuxHost::setMountingManager(std::shared_ptr<LinuxMountingManager> m) {
  impl_->mountingManager = std::move(m);
}

facebook::react::SurfaceHandler& RNLinuxHost::createSurface(
    std::string moduleName,
    std::string initialPropsJson) {
  RNL_LOGI("RNLinuxHost") << "createSurface module=" << moduleName
                          << " props=" << initialPropsJson;
  // TODO: construct SurfaceHandler, register with Scheduler, set layout
  // constraints (initialWidth/Height/pointScaleFactor), and return the
  // reference. Until headers are wired the caller cannot meaningfully use
  // the return; this is the stub.
  static facebook::react::SurfaceHandler* placeholder = nullptr;
  return *placeholder;  // intentional: real impl must replace this.
}

void RNLinuxHost::startSurface(facebook::react::SurfaceHandler&) {
  // TODO: scheduler_->registerSurface(s); s.start();
}

void RNLinuxHost::stopSurface(facebook::react::SurfaceHandler&) {
  // TODO: s.stop(); scheduler_->unregisterSurface(s);
}

}  // namespace rnlinux
