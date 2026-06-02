#pragma once

// IdleEventBeat — the GTK-driven `EventBeat` that replaces our previous
// `NoopEventBeat`. When the Fabric event queue requests a beat (a
// `eventEmitter_->dispatchEvent(...)` call enqueued a RawEvent), we
// schedule `induce()` on the GTK main loop via `g_idle_add`. `induce()`
// then hops to the JS thread via `RuntimeScheduler::scheduleWork` where
// the actual beat callback runs.
//
// Coalescing: a burst of `request()` calls collapses to a single idle
// callback because the base class' `isEventBeatRequested_` flag stays
// set across multiple requests until `induce()` runs.

#include <react/renderer/core/EventBeat.h>

namespace rnlinux {

class IdleEventBeat final : public facebook::react::EventBeat {
 public:
  IdleEventBeat(std::shared_ptr<OwnerBox> ownerBox,
                facebook::react::RuntimeScheduler& runtimeScheduler);
  ~IdleEventBeat() override;

  void request() const override;

  // Invoked from the glib idle callback on the GTK main thread.
  // Public so the static C-style trampoline in the .cpp can reach
  // it without befriending; not part of the EventBeat API.
  void fireIdle();

 private:
  // GLib idle source id — `0` means no idle queued. The atomic guards
  // the "queue once per burst" coalescing logic; multiple `request()`
  // calls from concurrent threads land on a single idle callback.
  mutable std::atomic<unsigned int> idleSourceId_{0};
};

} // namespace rnlinux
