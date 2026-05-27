#include "react-native-linux/RNLinuxHost.h"

#include "fabric/LinuxComponentDescriptorRegistry.h"
#include "fabric/LinuxMountingManager.h"
#include "fabric/LinuxSchedulerDelegate.h"
#include "jsi/BundleLoader.h"
#include "jsi/HermesRuntimeFactory.h"
#include "jsi/JsThread.h"
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
  // Hermes runs on its own pthread now (Phase 5.8). All JSI access
  // goes through jsThread->post / postSync. The host never touches
  // the runtime directly; even bundle eval is a postSync hop.
  std::unique_ptr<JsThread> jsThread;
  std::function<void(facebook::jsi::Runtime&)> beforeBundleEval;
  std::shared_ptr<facebook::react::ContextContainer> contextContainer;
  std::shared_ptr<facebook::react::ComponentDescriptorProviderRegistry> descriptorProviders;
  // RN 0.81's EventBeat ctor needs a RuntimeScheduler reference, and
  // the Scheduler itself doesn't construct one — the host owns it.
  // Lives on Impl so it outlives every EventBeat the factory hands out.
  std::shared_ptr<facebook::react::RuntimeScheduler> runtimeScheduler;
  std::unique_ptr<facebook::react::Scheduler> scheduler;
  std::unique_ptr<facebook::react::SurfaceHandler> rootSurface;
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

  // 1. Hermes runtime — constructed on its own worker pthread.
  //    JsThread's factory runs once on the worker; the runtime stays
  //    pinned to that thread for its entire lifetime, and every JSI
  //    access from the host code is a post/postSync hop. The user-
  //    visible win is that a heavy commit (akari's initial mount, a
  //    big feed re-render) no longer blocks GTK paint / resize /
  //    libsoup completion callbacks — those run on the main thread
  //    while JS chews on the worker.
  impl_->jsThread = std::make_unique<JsThread>("rnl-js", [] { return makeHermesRuntime(); });
  impl_->jsThread->waitForReady();
  RNL_LOGI("Hermes") << "runtime constructed";

  // 1a. Build the RuntimeExecutor early. Same instance flows into both
  //     the Scheduler's toolbox (below) and our rnLinux JSI bindings —
  //     every C++ async callback (dispatchFabric*, fetch result, timer
  //     fire) posts through it, so a libsoup completion landing on the
  //     main thread hops to the worker before touching the runtime.
  //     When the call already comes from the worker (React's commit
  //     machinery recursively scheduling more work), we invoke the
  //     callback synchronously to preserve the "runs right now" contract
  //     reconciler.updateContainer depends on — otherwise the first
  //     commit queues a task to itself and never completes.
  auto* jst = impl_->jsThread.get();
  auto runtimeExecutor = [jst](std::function<void(facebook::jsi::Runtime&)>&& fn) {
    if (!jst)
      return;
    if (jst->isCurrentThread()) {
      fn(jst->runtime());
    } else {
      jst->post(std::move(fn));
    }
  };
  setRuntimeExecutorForJsi(runtimeExecutor);

  // 1b. Install JSI bindings (rnLinux globals, etc.) before any bundle
  //     code runs. postSync so the host doesn't race the worker — by
  //     the time start() returns the bindings ARE up and the bundle
  //     can call into them.
  if (impl_->beforeBundleEval) {
    impl_->jsThread->postSync([this](facebook::jsi::Runtime& rt) { impl_->beforeBundleEval(rt); });
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

  toolbox.runtimeExecutor = runtimeExecutor;

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
  // "__fbBatchedBridge is undefined" warning we've been seeing. postSync
  // so this is in place before the bundle eval below tries to commit.
  {
    auto uiManager = impl_->scheduler->getUIManager();
    impl_->jsThread->postSync([&uiManager](facebook::jsi::Runtime& rt) {
      rt.global().setProperty(rt, "RN$Bridgeless", true);
      facebook::react::UIManagerBinding::createAndInstallIfNeeded(rt, uiManager);
    });
    RNL_LOGI("RNLinuxHost") << "nativeFabricUIManager installed";
  }

  // 3. Load + evaluate the bundle(s). With Fast Refresh, we split
  //    into a vendor bundle (React + reconciler + refresh + runtime/*)
  //    and an app bundle (user code). Vendor is loaded once and
  //    survives reload(); the app bundle re-evaluates on every save
  //    so $RefreshReg$ + performReactRefresh can patch the live tree.
  //
  //    Eval is `post` (fire-and-forget) — there's no host code below
  //    that depends on the bundle having finished evaluating, and
  //    posting unblocks the main thread so GTK can present the window
  //    before the 36 MB bundle finishes parsing.
  if (!config_.vendorBundleUrl.empty()) {
    const auto vendor = loadBundleSync(config_.vendorBundleUrl);
    if (!vendor.ok) {
      RNL_LOGE("RNLinuxHost") << "vendor bundle load failed: " << vendor.error;
      impl_->running = false;
      return;
    }
    RNL_LOGI("RNLinuxHost") << "vendor loaded (" << vendor.source.size() << " bytes from "
                            << vendor.sourceUrl << ")";
    impl_->jsThread->post(
        [source = vendor.source, url = vendor.sourceUrl](facebook::jsi::Runtime& rt) {
          RNL_LOGI("Hermes") << "evaluate " << url << " (" << source.size() << " bytes)";
          try {
            auto buffer = std::make_shared<facebook::jsi::StringBuffer>(source);
            rt.evaluateJavaScript(buffer, url);
            rt.drainMicrotasks();
          } catch (const facebook::jsi::JSError& e) {
            RNL_LOGE("Hermes") << "vendor eval JS error: " << e.getMessage() << "\nstack:\n"
                               << e.getStack();
          } catch (const std::exception& e) {
            RNL_LOGE("Hermes") << "vendor eval threw: " << e.what();
          }
        });
  }

  const auto bundle = loadBundleSync(config_.bundleUrl);
  if (!bundle.ok) {
    RNL_LOGE("RNLinuxHost") << "bundle load failed: " << bundle.error;
    impl_->running = false;
    return;
  }
  RNL_LOGI("RNLinuxHost") << "bundle loaded (" << bundle.source.size() << " bytes from "
                          << bundle.sourceUrl << ")";

  impl_->jsThread->post([source = bundle.source,
                         url = bundle.sourceUrl](facebook::jsi::Runtime& rt) {
    RNL_LOGI("Hermes") << "evaluate " << url << " (" << source.size() << " bytes)";
    try {
      auto buffer = std::make_shared<facebook::jsi::StringBuffer>(source);
      rt.evaluateJavaScript(buffer, url);
      rt.drainMicrotasks();
    } catch (const facebook::jsi::JSError& e) {
      RNL_LOGE("Hermes") << "app eval JS error: " << e.getMessage() << "\nstack:\n" << e.getStack();
    } catch (const std::exception& e) {
      RNL_LOGE("Hermes") << "app eval threw: " << e.what();
    }
  });
}

void RNLinuxHost::stop() {
  if (!impl_->running.exchange(false)) {
    return;
  }
  RNL_LOGI("RNLinuxHost") << "stopping";

  // Drop any state that still references the runtime (rnLinux JSI
  // bindings — click handlers in particular) BEFORE the runtime is
  // destroyed. Otherwise jsi::Function destructors call into a dead
  // runtime and crash on reload. resetRnLinuxBindings touches the
  // runtime to release its jsi::Function refs, so it must run on the
  // JS thread.
  if (impl_->jsThread) {
    impl_->jsThread->postSync([](facebook::jsi::Runtime&) { resetRnLinuxBindings(); });
  }
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
  // JsThread destructor joins the worker, which destroys the runtime
  // on its own thread (Hermes pthread-binding requirement).
  impl_->jsThread.reset();
}

void RNLinuxHost::reload() {
  RNL_LOGI("RNLinuxHost") << "reload requested (smooth)";
  if (!impl_->jsThread) {
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
  impl_->jsThread->post(
      [source = bundle.source, url = bundle.sourceUrl](facebook::jsi::Runtime& rt) {
        try {
          auto buffer = std::make_shared<facebook::jsi::StringBuffer>(source);
          rt.evaluateJavaScript(buffer, url);
          rt.drainMicrotasks();
        } catch (const facebook::jsi::JSError& e) {
          RNL_LOGE("Hermes") << "reload eval JS error: " << e.getMessage();
        } catch (const std::exception& e) {
          RNL_LOGE("Hermes") << "reload eval threw: " << e.what();
        }
      });
}

void RNLinuxHost::reloadFromSource(std::string source, std::string sourceUrl) {
  if (!impl_->jsThread) {
    RNL_LOGW("RNLinuxHost") << "reloadFromSource: runtime not yet up";
    return;
  }
  RNL_LOGI("RNLinuxHost") << "reload (socket-push): " << source.size() << " bytes from "
                          << sourceUrl;
  impl_->jsThread->post(
      [source = std::move(source), url = std::move(sourceUrl)](facebook::jsi::Runtime& rt) {
        try {
          auto buffer = std::make_shared<facebook::jsi::StringBuffer>(source);
          rt.evaluateJavaScript(buffer, url);
          rt.drainMicrotasks();
        } catch (const facebook::jsi::JSError& e) {
          RNL_LOGE("Hermes") << "reloadFromSource JS error: " << e.getMessage();
        } catch (const std::exception& e) {
          RNL_LOGE("Hermes") << "reloadFromSource threw: " << e.what();
        }
      });
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
  // surface.start() runs JS (RN$AppRegistry.runApplication → reconciler
  // updateContainer → completeRoot). That has to happen on the worker
  // because everything reachable from runApplication mutates the JSI
  // runtime; calling it from main would trap Hermes' pthread guard.
  // postSync so the host can log "surface started" only after the
  // initial render actually committed.
  impl_->jsThread->postSync([&surface](facebook::jsi::Runtime& rt) {
    try {
      surface.start();
    } catch (const facebook::jsi::JSError& e) {
      RNL_LOGE("RNLinuxHost") << "surface.start() JS error: " << e.getMessage();
      return;
    } catch (const std::exception& e) {
      RNL_LOGE("RNLinuxHost") << "surface.start() threw: " << e.what();
      return;
    } catch (...) {
      RNL_LOGE("RNLinuxHost") << "surface.start() threw unknown exception";
      return;
    }
    // React schedules post-commit passive effects (useEffect) as
    // microtasks; drain them so the very first render's effects fire
    // before this task returns instead of waiting for the next
    // JS-from-C++ entry-point.
    rt.drainMicrotasks();
  });
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
