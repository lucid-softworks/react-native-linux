#include "JsThread.h"

#include "react-native-linux/Logging.h"

#include <jsi/jsi.h>
#include <pthread.h>
#include <utility>

namespace rnlinux {

JsThread::JsThread(std::string name, RuntimeFactory factory)
    : name_(std::move(name))
    , factory_(std::move(factory)) {
  thread_ = std::thread([this] { run(); });
}

JsThread::~JsThread() {
  shutdown();
}

void JsThread::run() {
  // pthread_setname_np caps at 15 chars + NUL on Linux; truncate
  // silently rather than refusing.
  if (!name_.empty()) {
    std::string trimmed = name_.substr(0, 15);
    pthread_setname_np(pthread_self(), trimmed.c_str());
  }

  // Construct the runtime *on this thread*. Hermes binds the runtime
  // to its constructing thread (HermesRuntime::makeHermesRuntime
  // installs a JsThreadSafetyTrap that fires if the runtime is
  // touched from a different pthread), so this must not happen on
  // the main thread.
  std::unique_ptr<facebook::jsi::Runtime> rt;
  try {
    rt = factory_();
  } catch (const std::exception& e) {
    RNL_LOGE("JsThread") << "runtime factory threw: " << e.what();
  }

  {
    std::lock_guard<std::mutex> g(mu_);
    runtime_ = std::move(rt);
    ready_ = true;
  }
  readyCv_.notify_all();

  if (!runtime_) {
    RNL_LOGE("JsThread") << "no runtime; worker exiting";
    return;
  }

  for (;;) {
    Task task;
    {
      std::unique_lock<std::mutex> g(mu_);
      cv_.wait(g, [this] { return shutdown_ || !queue_.empty(); });
      if (shutdown_ && queue_.empty()) {
        break;
      }
      task = std::move(queue_.front());
      queue_.pop();
    }
    try {
      task(*runtime_);
    } catch (const facebook::jsi::JSError& e) {
      RNL_LOGE("JsThread") << "task threw JSError: " << e.getMessage();
    } catch (const std::exception& e) {
      RNL_LOGE("JsThread") << "task threw: " << e.what();
    }
  }

  // Tear the runtime down on this thread — same locality requirement
  // as construction. The unique_ptr reset hits Hermes' destructor;
  // anything still holding a jsi::Function reference (rnLinux
  // callbacks, image fetch onResult) must be cleared BEFORE
  // shutdown is called or the dtor crashes on a dangling weak ref.
  std::unique_ptr<facebook::jsi::Runtime> doomed;
  {
    std::lock_guard<std::mutex> g(mu_);
    doomed = std::move(runtime_);
  }
  doomed.reset();
}

void JsThread::waitForReady() {
  std::unique_lock<std::mutex> g(mu_);
  readyCv_.wait(g, [this] { return ready_; });
}

void JsThread::post(Task task) {
  if (!task)
    return;
  {
    std::lock_guard<std::mutex> g(mu_);
    if (shutdown_) {
      // Post-shutdown tasks are dropped silently — the runtime is
      // already gone, so even if we queued the task no one would
      // service it. Matches `g_idle_add` after `gtk_main_quit`.
      return;
    }
    queue_.push(std::move(task));
  }
  cv_.notify_one();
}

void JsThread::postSync(Task task) {
  if (!task)
    return;
  if (std::this_thread::get_id() == thread_.get_id()) {
    // Running on the worker already — invoking sync would deadlock
    // on the cv. Fail loud so the call site notices.
    RNL_LOGE("JsThread") << "postSync called from worker thread; deadlock prevented";
    return;
  }

  std::mutex localMu;
  std::condition_variable localCv;
  bool done = false;

  post([&](facebook::jsi::Runtime& rt) {
    try {
      task(rt);
    } catch (...) {
      // Swallow exceptions on the worker side — the standard task
      // path logs them, the caller below just needs to know the
      // task ran. Without this the lambda's exception leaves
      // `done` false and the caller hangs forever.
    }
    {
      std::lock_guard<std::mutex> g(localMu);
      done = true;
    }
    localCv.notify_one();
  });

  std::unique_lock<std::mutex> g(localMu);
  localCv.wait(g, [&] { return done; });
}

void JsThread::shutdown() {
  bool wasShutdown;
  {
    std::lock_guard<std::mutex> g(mu_);
    wasShutdown = shutdown_;
    shutdown_ = true;
  }
  if (wasShutdown)
    return;
  cv_.notify_all();
  if (thread_.joinable()) {
    thread_.join();
  }
}

} // namespace rnlinux
