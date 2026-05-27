#include "react-native-linux/RNLinuxHost.h"

#include "fabric/LinuxComponentDescriptorRegistry.h"
#include "fabric/LinuxMountingManager.h"
#include "fabric/LinuxSchedulerDelegate.h"
#include "jsi/BundleLoader.h"
#include "jsi/HermesRuntimeFactory.h"
#include "jsi/RnLinuxBindings.h"
#include "react-native-linux/Logging.h"

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/EventBeat.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <react/renderer/scheduler/Scheduler.h>
#include <react/renderer/scheduler/SchedulerToolbox.h>
#include <react/renderer/scheduler/SurfaceHandler.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <react/utils/ContextContainer.h>
#include <string>
#include <thread>
#include <utility>

namespace rnlinux {

struct RNLinuxHost::Impl {
  std::shared_ptr<LinuxMountingManager> mountingManager;
  std::unique_ptr<LinuxSchedulerDelegate> schedulerDelegate;
  std::unique_ptr<HermesRuntimeHolder> runtimeHolder;
  std::function<void(facebook::jsi::Runtime&)> beforeBundleEval;
  std::shared_ptr<facebook::react::ContextContainer> contextContainer;
  std::shared_ptr<facebook::react::ComponentDescriptorProviderRegistry> descriptorProviders;
  // RN 0.81's EventBeat ctor needs a RuntimeScheduler reference, and
  // the Scheduler itself doesn't construct one — the host owns it.
  // Lives on Impl so it outlives every EventBeat the factory hands out.
  std::shared_ptr<facebook::react::RuntimeScheduler> runtimeScheduler;
  std::unique_ptr<facebook::react::Scheduler> scheduler;
  std::unique_ptr<facebook::react::SurfaceHandler> rootSurface;
  std::thread jsThread;
  std::atomic<bool> running{false};
};

RNLinuxHost::RNLinuxHost(Config config)
    : impl_(std::make_unique<Impl>())
    , config_(std::move(config)) {}

RNLinuxHost::~RNLinuxHost() {
  stop();
}

namespace {

// Synchronously turn an async BundleLoader call into bytes-or-error.
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

// MVP EventBeat — does nothing. The base class' `request()` flips a flag,
// `induce()` is a no-op, and we never actually deliver events through it.
// Good enough to satisfy the Scheduler's "must be non-null" contract while
// we don't have a JS thread. Real timers + GTK-driven beats land in Phase
// 5.8.
class NoopEventBeat final : public facebook::react::EventBeat {
 public:
  using EventBeat::EventBeat;
};

} // namespace

void RNLinuxHost::start() {
  if (impl_->running.exchange(true)) {
    return;
  }
  RNL_LOGI("RNLinuxHost") << "starting (bundle=" << config_.bundleUrl << ")";

  // 1. Hermes runtime.
  impl_->runtimeHolder = makeHermesRuntimeHolder();

  // 1a. Install JSI bindings (rnLinux globals, etc.) before any bundle
  //     code runs.
  if (impl_->beforeBundleEval) {
    impl_->beforeBundleEval(impl_->runtimeHolder->runtime());
  }

  // 2. Fabric Scheduler. Built before bundle eval so commit hooks
  //    landing during JS bootstrap have a registry to talk to.
  impl_->schedulerDelegate = std::make_unique<LinuxSchedulerDelegate>(impl_->mountingManager);
  impl_->contextContainer = std::make_shared<facebook::react::ContextContainer>();
  // RN 0.81 retired ContextContainer-based ReactNativeConfig in favour
  // of the global ReactNativeFeatureFlags singleton — the Scheduler no
  // longer touches the container for feature lookups, so no
  // registration needed.
  //
  // ParagraphComponentDescriptor looks up a TextLayoutManager via
  // getManagerByName(TextLayoutManagerKey). Without it, every
  // ParagraphShadowNode gets `setTextLayoutManager(nullptr)` and the
  // `updateStateIfNeeded` path bails before calling `setStateData`,
  // so our Pango-backed updateState never receives the AttributedString
  // and every <Text> renders as an empty GtkLabel.
  impl_->contextContainer->insert(
      "TextLayoutManager",
      std::shared_ptr<facebook::react::TextLayoutManager>(
          std::make_shared<facebook::react::TextLayoutManager>(impl_->contextContainer)));
  impl_->descriptorProviders = makeLinuxComponentDescriptorRegistry();

  facebook::react::SchedulerToolbox toolbox;
  toolbox.contextContainer = impl_->contextContainer;
  // ComponentRegistryFactory turns the providers + a per-surface
  // EventDispatcher into a live ComponentDescriptorRegistry.
  {
    auto providers = impl_->descriptorProviders;
    toolbox.componentRegistryFactory =
        [providers](const facebook::react::EventDispatcher::Weak& eventDispatcher,
                    const facebook::react::ContextContainer::Shared& cc) {
          return providers->createComponentDescriptorRegistry({eventDispatcher, cc});
        };
  }

  // RuntimeExecutor: hand the callback our jsi::Runtime synchronously.
  // Works only because JS evaluation runs on this same thread today;
  // when we add the JS thread (Phase 5.8) this becomes a real queue.
  {
    auto* runtime = &impl_->runtimeHolder->runtime();
    toolbox.runtimeExecutor = [runtime](std::function<void(facebook::jsi::Runtime&)>&& fn) {
      if (runtime)
        fn(*runtime);
    };
  }

  // Stand up a RuntimeScheduler. Every EventBeat the factory hands out
  // needs a reference to it (0.81 moved the ownership model so the host
  // — not the Scheduler — owns the RuntimeScheduler). We pass the same
  // RuntimeExecutor that drives the rest of the Scheduler so work is
  // serialised on the JS thread.
  impl_->runtimeScheduler =
      std::make_shared<facebook::react::RuntimeScheduler>(toolbox.runtimeExecutor);

  // Scheduler::Scheduler() in 0.81 fetches the RuntimeScheduler from
  // contextContainer via RuntimeSchedulerKey (`react_native_assert`
  // fires if it's missing). Register a weak ref so the asserter
  // resolves; the host retains the strong ref on Impl.
  impl_->contextContainer->insert(
      facebook::react::RuntimeSchedulerKey,
      std::weak_ptr<facebook::react::RuntimeScheduler>(impl_->runtimeScheduler));

  // EventBeat factory: produce a noop beat. Sufficient to satisfy the
  // Scheduler's non-null requirement; real event flow lands later.
  auto& runtimeScheduler = *impl_->runtimeScheduler;
  toolbox.eventBeatFactory =
      [&runtimeScheduler](std::shared_ptr<facebook::react::EventBeat::OwnerBox> ownerBox)
      -> std::unique_ptr<facebook::react::EventBeat> {
    return std::make_unique<NoopEventBeat>(std::move(ownerBox), runtimeScheduler);
  };

  impl_->scheduler = std::make_unique<facebook::react::Scheduler>(
      toolbox, /*animationDelegate=*/nullptr, impl_->schedulerDelegate.get());
  RNL_LOGI("RNLinuxHost") << "scheduler constructed";

  // Install `globalThis.nativeFabricUIManager` and flag the runtime as
  // bridgeless. ReactFabric on the JS side reaches for these to drive
  // shadow-tree commits. Without this, surface.start() generates the
  // "__fbBatchedBridge is undefined" warning we've been seeing.
  {
    auto& rt = impl_->runtimeHolder->runtime();
    rt.global().setProperty(rt, "RN$Bridgeless", true);
    facebook::react::UIManagerBinding::createAndInstallIfNeeded(rt,
                                                                impl_->scheduler->getUIManager());
    RNL_LOGI("RNLinuxHost") << "nativeFabricUIManager installed";
  }

  // 3. Load + evaluate the bundle(s). With Fast Refresh, we split
  //    into a vendor bundle (React + reconciler + refresh + runtime/*)
  //    and an app bundle (user code). Vendor is loaded once and
  //    survives reload(); the app bundle re-evaluates on every save
  //    so $RefreshReg$ + performReactRefresh can patch the live tree.
  if (!config_.vendorBundleUrl.empty()) {
    const auto vendor = loadBundleSync(config_.vendorBundleUrl);
    if (!vendor.ok) {
      RNL_LOGE("RNLinuxHost") << "vendor bundle load failed: " << vendor.error;
      impl_->running = false;
      return;
    }
    RNL_LOGI("RNLinuxHost") << "vendor loaded (" << vendor.source.size() << " bytes from "
                            << vendor.sourceUrl << ")";
    if (!impl_->runtimeHolder->evaluate(vendor.source, vendor.sourceUrl)) {
      RNL_LOGE("RNLinuxHost") << "vendor bundle evaluation failed";
    }
  }

  const auto bundle = loadBundleSync(config_.bundleUrl);
  if (!bundle.ok) {
    RNL_LOGE("RNLinuxHost") << "bundle load failed: " << bundle.error;
    impl_->running = false;
    return;
  }
  RNL_LOGI("RNLinuxHost") << "bundle loaded (" << bundle.source.size() << " bytes from "
                          << bundle.sourceUrl << ")";

  if (!impl_->runtimeHolder->evaluate(bundle.source, bundle.sourceUrl)) {
    RNL_LOGE("RNLinuxHost") << "bundle evaluation failed; runtime still alive";
  }
}

void RNLinuxHost::stop() {
  if (!impl_->running.exchange(false)) {
    return;
  }
  RNL_LOGI("RNLinuxHost") << "stopping";

  if (impl_->jsThread.joinable()) {
    impl_->jsThread.join();
  }
  // Drop any state that still references the runtime (rnLinux JSI
  // bindings — click handlers in particular) BEFORE the runtime is
  // destroyed. Otherwise jsi::Function destructors call into a dead
  // runtime and crash on reload.
  resetRnLinuxBindings();
  // Inverse-order teardown: surface → scheduler → delegate → registry → runtime.
  if (impl_->rootSurface && impl_->scheduler) {
    // Unregistering an already-stopped surface is a no-op; unregistering
    // a *started* one asserts inside setUIManager(nullptr). Stop first.
    impl_->rootSurface->stop();
    impl_->scheduler->unregisterSurface(*impl_->rootSurface);
  }
  impl_->rootSurface.reset();
  impl_->scheduler.reset();
  impl_->schedulerDelegate.reset();
  impl_->descriptorProviders.reset();
  impl_->contextContainer.reset();
  impl_->runtimeHolder.reset();
}

void RNLinuxHost::reload() {
  RNL_LOGI("RNLinuxHost") << "reload requested (smooth)";
  if (!impl_->runtimeHolder) {
    // Cold start: nothing to preserve, go through the normal start path.
    start();
    return;
  }
  // Smooth re-eval: keep the Hermes runtime, Scheduler, Surface,
  // MountingManager, and GTK window alive. The bundle reruns inside
  // the same context — Fast Refresh (when wired up JS-side) sees
  // the new component types and patches the React tree in place
  // via $RefreshReg$ / performReactRefresh; without it the tree
  // remounts but the window doesn't blink and Hermes doesn't pay
  // its startup cost again.
  const auto bundle = loadBundleSync(config_.bundleUrl);
  if (!bundle.ok) {
    RNL_LOGE("RNLinuxHost") << "reload: bundle load failed: " << bundle.error;
    return;
  }
  RNL_LOGI("RNLinuxHost") << "reload: re-evaluating bundle (" << bundle.source.size() << " bytes)";
  impl_->runtimeHolder->evaluate(bundle.source, bundle.sourceUrl);
}

void RNLinuxHost::reloadFromSource(std::string source, std::string sourceUrl) {
  if (!impl_->runtimeHolder) {
    RNL_LOGW("RNLinuxHost") << "reloadFromSource: runtime not yet up";
    return;
  }
  RNL_LOGI("RNLinuxHost") << "reload (socket-push): " << source.size() << " bytes from "
                          << sourceUrl;
  impl_->runtimeHolder->evaluate(source, sourceUrl);
}

void RNLinuxHost::setMountingManager(std::shared_ptr<LinuxMountingManager> m) {
  impl_->mountingManager = std::move(m);
}

void RNLinuxHost::setBeforeBundleEvalHook(std::function<void(facebook::jsi::Runtime&)> hook) {
  impl_->beforeBundleEval = std::move(hook);
}

facebook::react::SurfaceHandler& RNLinuxHost::createSurface(std::string moduleName,
                                                            std::string initialPropsJson) {
  RNL_LOGI("RNLinuxHost") << "createSurface module=" << moduleName << " props=" << initialPropsJson;

  if (!impl_->scheduler) {
    RNL_LOGE("RNLinuxHost") << "createSurface called before scheduler was constructed";
    static facebook::react::SurfaceHandler* placeholder = nullptr;
    return *placeholder;
  }

  // SurfaceHandler is constructed with a stable surface id (1 for the
  // single-root MVP) and a module name. We default LayoutConstraints to
  // the configured window size; the Scheduler runs Yoga against that
  // when JS commits a tree.
  impl_->rootSurface =
      std::make_unique<facebook::react::SurfaceHandler>(moduleName, /*surfaceId=*/1);
  impl_->rootSurface->setProps(folly::dynamic::object());
  // Layout tracks the viewport exactly (min == max so flex:1 fills
  // precisely). The initial layout uses the design size as an estimate
  // because the GtkWidget hasn't been allocated yet; the first tick
  // from RNLinuxApplication's resize tick-callback corrects it to the
  // real GtkScrolledWindow allocation. We intentionally do NOT floor
  // at the design size — flooring made the outer GtkScrolledWindow
  // scroll on any window whose content area was shorter than the
  // default (e.g. once CSD eats ~40px), which dragged the tab bar at
  // the bottom of any flex-column layout off the visible region.
  const auto W = static_cast<facebook::react::Float>(config_.initialWidth);
  const auto H = static_cast<facebook::react::Float>(config_.initialHeight);
  impl_->rootSurface->constraintLayout(
      {{W, H}, {W, H}, facebook::react::LayoutDirection::LeftToRight},
      {.pointScaleFactor = static_cast<facebook::react::Float>(config_.pointScaleFactor)});
  return *impl_->rootSurface;
}

void RNLinuxHost::resizeRootSurface(int w, int h) {
  if (!impl_->rootSurface)
    return;
  if (w <= 0 || h <= 0)
    return;
  // Track the viewport one-for-one. See createSurface() for why the
  // old `max(viewport, design)` floor is gone.
  RNL_LOGI("RNLinuxHost") << "resize → layout " << w << "x" << h;
  const auto W = static_cast<facebook::react::Float>(w);
  const auto H = static_cast<facebook::react::Float>(h);
  impl_->rootSurface->constraintLayout(
      {{W, H}, {W, H}, facebook::react::LayoutDirection::LeftToRight},
      {.pointScaleFactor = static_cast<facebook::react::Float>(config_.pointScaleFactor)});
}

void RNLinuxHost::startSurface(facebook::react::SurfaceHandler& surface) {
  if (!impl_->scheduler) {
    RNL_LOGE("RNLinuxHost") << "startSurface called without a scheduler";
    return;
  }
  impl_->scheduler->registerSurface(surface);
  // SurfaceHandler::start() drives into UIManager::startSurface() ->
  // SurfaceRegistryBinding::startSurface(rt, surfaceId, moduleName,
  // ...), which calls `globalThis.RN$AppRegistry.runApplication(...)`.
  // Our bundle (apps/playground/runtime/fabric.js) installs that hook
  // and uses nativeFabricUIManager to commit a shadow tree, so the
  // call no longer std::terminate's.
  try {
    surface.start();
  } catch (const std::exception& e) {
    RNL_LOGE("RNLinuxHost") << "surface.start() threw: " << e.what();
    return;
  } catch (...) {
    RNL_LOGE("RNLinuxHost") << "surface.start() threw unknown exception";
    return;
  }
  // surface.start() runs JS (RN$AppRegistry.runApplication, which then
  // does reconciler.updateContainer → completeRoot). React schedules
  // post-commit passive effects (useEffect) as microtasks; drain them
  // now so the very first render's effects fire without waiting for
  // the next JS-from-C++ entry-point.
  impl_->runtimeHolder->runtime().drainMicrotasks();
  RNL_LOGI("RNLinuxHost") << "surface started";
}

void RNLinuxHost::stopSurface(facebook::react::SurfaceHandler& surface) {
  if (!impl_->scheduler) {
    return;
  }
  surface.stop();
  impl_->scheduler->unregisterSurface(surface);
}

} // namespace rnlinux
