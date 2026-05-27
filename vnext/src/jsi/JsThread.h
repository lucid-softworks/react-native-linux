#pragma once

#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <queue>
#include <thread>

namespace facebook::jsi {
class Runtime;
}

namespace rnlinux {

// Owns the Hermes runtime and the worker pthread that runs JS.
//
// The runtime is constructed *on* the worker thread, never accessed
// directly from outside, and torn down on the worker before the
// thread joins. All access from C++ goes through post / postSync,
// which marshal the std::function onto the worker's queue.
//
// This is the single chokepoint Real RN uses to keep JS off the UI
// thread on iOS / Android (`-[RCTJSThread runRunLoop]` /
// `JSCallInvoker` respectively). Here it's the Phase 5.8 split that
// stops a heavy commit (akari's initial mount, the cold-start render
// of a 36 MB bundle) from freezing the GTK main loop — paint,
// resize, and libsoup fetch callbacks keep running while JS chews.
class JsThread {
 public:
  // Factory the runtime *on the worker* and call `onStarted` once
  // it's live. The thread keeps draining the queue until `shutdown`
  // is called; the runtime is destroyed on the worker before join.
  //
  // `name` shows up in `pthread_setname_np` for easier perf
  // attribution (the panel in `top` / GNOME Usage shows it as the
  // thread name).
  using RuntimeFactory = std::function<std::unique_ptr<facebook::jsi::Runtime>()>;
  using Task = std::function<void(facebook::jsi::Runtime&)>;

  JsThread(std::string name, RuntimeFactory factory);
  ~JsThread();

  JsThread(const JsThread&) = delete;
  JsThread& operator=(const JsThread&) = delete;

  // Block until the runtime is constructed and the worker is
  // draining its queue. Bundle eval / binding install / surface
  // start should all happen *after* this returns to avoid a race
  // where the first posted task reaches the worker before the
  // runtime is alive.
  void waitForReady();

  // Queue a function to run on the worker. The runtime ref handed
  // in is valid for the duration of the call. Tasks run in FIFO
  // order; the worker drains the queue then sleeps on the cv.
  //
  // Safe to call from any thread, including before the runtime is
  // ready — the task waits in the queue until it is.
  void post(Task task);

  // Block the calling thread until the task has run on the worker.
  // Useful from boot (bundle eval) and shutdown — every other
  // call site should prefer `post` so a slow JS commit can't
  // freeze the UI thread.
  //
  // PANICS if called from the worker itself (would deadlock).
  void postSync(Task task);

  // True iff the calling thread is the worker. Used by the React
  // RuntimeExecutor wrapper to decide between sync-invoke
  // (already on the worker, preserve commit semantics) and post
  // (cross-thread hop).
  bool isCurrentThread() const;

  // Direct runtime accessor — UNSAFE except from inside a task
  // running on the worker. Exposes the runtime so a synchronous
  // RuntimeExecutor invocation can hand it back to the caller
  // without going through the queue.
  facebook::jsi::Runtime& runtime();

  // Stop the worker, drain the queue, destroy the runtime, join the
  // thread. Idempotent.
  void shutdown();

 private:
  void run();

  std::string name_;
  RuntimeFactory factory_;
  std::thread thread_;

  std::mutex mu_;
  std::condition_variable cv_;
  std::queue<Task> queue_;
  std::unique_ptr<facebook::jsi::Runtime> runtime_;
  bool ready_ = false;
  bool shutdown_ = false;

  std::condition_variable readyCv_;
};

} // namespace rnlinux
