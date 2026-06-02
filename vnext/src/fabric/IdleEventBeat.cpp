#include "IdleEventBeat.h"

#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>

namespace rnlinux {

namespace {

// The idle callback fires on the GTK main thread. It invokes
// `induce()` on the beat (which checks `isEventBeatRequested_` and
// hops to JS via the runtime scheduler) and clears the cached
// source id so a subsequent `request()` can re-queue.
gboolean onIdleFire(gpointer user_data) {
  auto* beat = static_cast<IdleEventBeat*>(user_data);
  beat->fireIdle();
  // Returning FALSE here removes the idle source automatically.
  return FALSE;
}

} // namespace

IdleEventBeat::IdleEventBeat(std::shared_ptr<OwnerBox> ownerBox,
                             facebook::react::RuntimeScheduler& runtimeScheduler)
    : EventBeat(std::move(ownerBox), runtimeScheduler) {}

IdleEventBeat::~IdleEventBeat() {
  // Drop any pending idle so we don't fire after destruction.
  auto id = idleSourceId_.exchange(0);
  if (id != 0) {
    g_source_remove(id);
  }
}

void IdleEventBeat::request() const {
  // Forward to the base class first — that's what flips the
  // `isEventBeatRequested_` flag induce() consumes.
  EventBeat::request();

  // Coalesce: if an idle is already queued, the next call to
  // `induce()` will handle whatever requests piled up in between.
  unsigned int expected = 0;
  unsigned int newId =
      g_idle_add_full(G_PRIORITY_HIGH_IDLE, onIdleFire, const_cast<IdleEventBeat*>(this), nullptr);
  if (!idleSourceId_.compare_exchange_strong(expected, newId)) {
    // Lost the race — someone else queued already. Cancel ours.
    g_source_remove(newId);
  }
}

void IdleEventBeat::fireIdle() {
  // Clear the cached id before induce() so a beat callback that
  // itself enqueues another event can re-queue an idle cleanly.
  idleSourceId_.store(0);
  RNL_LOGD("IdleEventBeat") << "idle fire → induce()";
  induce();
}

} // namespace rnlinux
