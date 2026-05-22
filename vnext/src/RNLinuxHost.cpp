#include "react-native-linux/RNLinuxHost.h"
#include "react-native-linux/Logging.h"

#include "fabric/LinuxComponentDescriptorRegistry.h"
#include "fabric/LinuxMountingManager.h"
#include "fabric/LinuxSchedulerDelegate.h"
#include "jsi/BundleLoader.h"
#include "jsi/HermesRuntimeFactory.h"

#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace rnlinux {

struct RNLinuxHost::Impl {
  std::shared_ptr<LinuxMountingManager> mountingManager;
  std::unique_ptr<LinuxSchedulerDelegate> schedulerDelegate;
  std::unique_ptr<HermesRuntimeHolder> runtimeHolder;
  std::thread jsThread;
  std::atomic<bool> running{false};

  // TODO (Phase 5.3): store facebook::react::Scheduler once we can construct
  // a SchedulerToolbox without crashing on partial RN headers.
};

RNLinuxHost::RNLinuxHost(Config config)
    : impl_(std::make_unique<Impl>()), config_(std::move(config)) {}

RNLinuxHost::~RNLinuxHost() {
  stop();
}

namespace {

// Synchronously turn an async BundleLoader call into bytes-or-error. The
// MVP host calls this on whatever thread invoked start() — typically the
// UI thread once. Acceptable while bundle loads are O(50ms) for file://
// and O(seconds) for http://; revisit when we need to keep the UI loop
// responsive during reload.
struct SyncBundleResult {
  bool ok = false;
  std::string source;
  std::string sourceUrl;
  std::string error;
};

SyncBundleResult loadBundleSync(const std::string& url) {
  SyncBundleResult out;
  std::mutex mu;
  std::condition_variable cv;
  bool done = false;
  loadBundle(url, [&](BundleLoadResult res) {
    std::lock_guard<std::mutex> g{mu};
    if (res.ok) {
      out.ok = true;
      out.source.assign(res.bytes.begin(), res.bytes.end());
      out.sourceUrl = res.sourceUrl;
    } else {
      out.error = std::move(res.error);
    }
    done = true;
    cv.notify_one();
  });
  std::unique_lock<std::mutex> lk{mu};
  cv.wait(lk, [&] { return done; });
  return out;
}

}  // namespace

void RNLinuxHost::start() {
  if (impl_->running.exchange(true)) {
    return;
  }
  RNL_LOGI("RNLinuxHost") << "starting (bundle=" << config_.bundleUrl << ")";

  // 1. Create the Hermes runtime.
  impl_->runtimeHolder = makeHermesRuntimeHolder();

  // 2. Load the bundle synchronously (Phase 5.2 first pass — see TODO).
  const auto bundle = loadBundleSync(config_.bundleUrl);
  if (!bundle.ok) {
    RNL_LOGE("RNLinuxHost") << "bundle load failed: " << bundle.error;
    impl_->running = false;
    return;
  }
  RNL_LOGI("RNLinuxHost") << "bundle loaded (" << bundle.source.size()
                          << " bytes from " << bundle.sourceUrl << ")";

  // 3. Evaluate the bundle on the calling thread. Single-threaded for the
  //    first cut; a dedicated JS thread + folly RuntimeExecutor lands in
  //    the next Phase 5.2 commit.
  if (!impl_->runtimeHolder->evaluate(bundle.source, bundle.sourceUrl)) {
    RNL_LOGE("RNLinuxHost") << "bundle evaluation failed; runtime still alive";
    // Leave running=true so callers can inspect; reload() can replace.
  }

  // 4. Fabric Scheduler — still stubbed. Phase 5.3.
  impl_->schedulerDelegate =
      std::make_unique<LinuxSchedulerDelegate>(impl_->mountingManager);
}

void RNLinuxHost::stop() {
  if (!impl_->running.exchange(false)) {
    return;
  }
  RNL_LOGI("RNLinuxHost") << "stopping";

  if (impl_->jsThread.joinable()) {
    impl_->jsThread.join();
  }
  // Tear down in the inverse order of construction: scheduler bits first
  // (they hold JSI references), then the runtime.
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
  // TODO (Phase 5.3): construct SurfaceHandler, register with Scheduler,
  // set layout constraints. Until then the caller cannot meaningfully
  // use the return value.
  static facebook::react::SurfaceHandler* placeholder = nullptr;
  return *placeholder;
}

void RNLinuxHost::startSurface(facebook::react::SurfaceHandler&) {
  // TODO (Phase 5.3): scheduler_->registerSurface(s); s.start();
}

void RNLinuxHost::stopSurface(facebook::react::SurfaceHandler&) {
  // TODO (Phase 5.3): s.stop(); scheduler_->unregisterSurface(s);
}

}  // namespace rnlinux
