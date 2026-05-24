#include "LinuxSchedulerDelegate.h"
#include "LinuxMountingManager.h"
#include "react-native-linux/Logging.h"

#include <react/renderer/mounting/MountingCoordinator.h>
#include <react/renderer/mounting/MountingTransaction.h>

#include <gtk/gtk.h>

namespace rnlinux {

namespace {

// Glue between SchedulerDelegate's JS-thread callbacks and the GTK main
// loop. The delegate hands ownership of a coordinator pointer + manager
// pointer (both heap-allocated to survive the cross-thread hop) to
// g_idle_add, which invokes us on the UI thread.
struct PendingTransaction {
  std::shared_ptr<LinuxMountingManager> mountingManager;
  facebook::react::MountingCoordinator::Shared coordinator;
};

gboolean dispatchTransactionOnUiThread(gpointer data) {
  auto* pending = static_cast<PendingTransaction*>(data);
  if (auto tx = pending->coordinator->pullTransaction()) {
    pending->mountingManager->performTransaction(*tx);
  }
  delete pending;
  return G_SOURCE_REMOVE;
}

}  // namespace

LinuxSchedulerDelegate::LinuxSchedulerDelegate(
    std::shared_ptr<LinuxMountingManager> mm)
    : mountingManager_(std::move(mm)) {}

LinuxSchedulerDelegate::~LinuxSchedulerDelegate() = default;

void LinuxSchedulerDelegate::schedulerDidFinishTransaction(
    const facebook::react::MountingCoordinator::Shared& coordinator) {
  if (!mountingManager_) {
    RNL_LOGW("SchedulerDelegate") << "no mounting manager — dropping transaction";
    return;
  }
  RNL_LOGD("SchedulerDelegate") << "transaction queued for UI thread";
  auto* pending = new PendingTransaction{mountingManager_, coordinator};
  g_idle_add(dispatchTransactionOnUiThread, pending);
}

void LinuxSchedulerDelegate::schedulerShouldRenderTransactions(
    const facebook::react::MountingCoordinator::Shared& coordinator) {
  // For our MVP we treat "should render" the same as "did finish" — the
  // distinction matters on Android where MapBuffer props need a second
  // pass. Revisit when we support legacy view managers.
  schedulerDidFinishTransaction(coordinator);
}

void LinuxSchedulerDelegate::schedulerDidRequestPreliminaryViewAllocation(
    const facebook::react::ShadowNode& /*shadowNode*/) {
  // Optimization hook: lets a platform pre-allocate widgets before the
  // commit. GTK widget construction is cheap, so a no-op is fine.
}

void LinuxSchedulerDelegate::schedulerDidDispatchCommand(
    const facebook::react::ShadowView& /*shadowView*/,
    const std::string& commandName,
    const folly::dynamic& /*args*/) {
  RNL_LOGI("SchedulerDelegate") << "dispatchCommand: " << commandName
                                << " (no handler yet)";
  // TODO (Phase 9): route to LinuxComponentView::dispatchCommand once we
  // support `focus()` / `scrollTo()` / etc.
}

void LinuxSchedulerDelegate::schedulerDidSendAccessibilityEvent(
    const facebook::react::ShadowView& /*shadowView*/,
    const std::string& eventType) {
  RNL_LOGD("SchedulerDelegate") << "a11y event: " << eventType;
  // TODO (Phase 9): emit through ATK / AT-SPI2 once a11y bridges land.
}

void LinuxSchedulerDelegate::schedulerDidSetIsJSResponder(
    const facebook::react::ShadowView& /*shadowView*/,
    bool /*isJSResponder*/,
    bool /*blockNativeResponder*/) {
  // GTK gesture controllers manage their own grab state; no equivalent to
  // RN's "JS responder" concept is needed for the touch model we expose.
}

}  // namespace rnlinux
