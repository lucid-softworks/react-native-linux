#include "LinuxSchedulerDelegate.h"

#include "LinuxMountingManager.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <react/renderer/mounting/MountingCoordinator.h>
#include <react/renderer/mounting/MountingTransaction.h>

namespace rnlinux {

namespace {

// Glue between SchedulerDelegate's JS-thread callbacks and the GTK main
// loop. The delegate hands ownership of a coordinator pointer + manager
// pointer (both heap-allocated to survive the cross-thread hop) to
// g_idle_add, which invokes us on the UI thread.
struct PendingTransaction {
  std::shared_ptr<LinuxMountingManager> mountingManager;
  std::shared_ptr<const facebook::react::MountingCoordinator> coordinator;
};

gboolean dispatchTransactionOnUiThread(gpointer data) {
  auto* pending = static_cast<PendingTransaction*>(data);
  auto tx = pending->coordinator->pullTransaction();
  RNL_LOGD("SchedulerDelegate") << "pullTransaction → " << (tx ? "ok" : "empty");
  if (tx) {
    pending->mountingManager->performTransaction(*tx);
  }
  // Empty pull is normal: multiple "queued" events coalesce into one
  // transaction, so the first idle dispatch consumes it and the rest
  // are no-ops.
  delete pending;
  return G_SOURCE_REMOVE;
}

} // namespace

LinuxSchedulerDelegate::LinuxSchedulerDelegate(std::shared_ptr<LinuxMountingManager> mm)
    : mountingManager_(std::move(mm)) {}

LinuxSchedulerDelegate::~LinuxSchedulerDelegate() = default;

void LinuxSchedulerDelegate::schedulerDidFinishTransaction(
    const std::shared_ptr<const facebook::react::MountingCoordinator>& coordinator) {
  if (!mountingManager_) {
    RNL_LOGW("SchedulerDelegate") << "no mounting manager — dropping transaction";
    return;
  }
  RNL_LOGI("SchedulerDelegate") << "transaction queued for UI thread";
  auto* pending = new PendingTransaction{mountingManager_, coordinator};
  // Phase 5.8: this delegate fires from the JS worker thread.
  // `g_main_context_invoke_full` is the GLib idiom for "run this on
  // the main context's loop" from any thread — internally it adds an
  // idle source that's GUARANTEED to fire on the main context (the
  // one g_application_run iterates), unlike `g_idle_add` which uses
  // the thread-default context (different per thread). Without this
  // the queued transactions sit forever and the rendered tree never
  // reaches GTK.
  g_main_context_invoke_full(g_main_context_default(),
                             G_PRIORITY_HIGH_IDLE,
                             dispatchTransactionOnUiThread,
                             pending,
                             /*notify=*/nullptr);
}

void LinuxSchedulerDelegate::schedulerShouldRenderTransactions(
    const std::shared_ptr<const facebook::react::MountingCoordinator>& coordinator) {
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
  RNL_LOGI("SchedulerDelegate") << "dispatchCommand: " << commandName << " (no handler yet)";
  // TODO (Phase 9): route to LinuxComponentView::dispatchCommand once we
  // support `focus()` / `scrollTo()` / etc.
}

void LinuxSchedulerDelegate::schedulerDidSendAccessibilityEvent(
    const facebook::react::ShadowView& /*shadowView*/, const std::string& eventType) {
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

void LinuxSchedulerDelegate::schedulerShouldSynchronouslyUpdateViewOnUIThread(
    facebook::react::Tag /*tag*/, const folly::dynamic& /*props*/) {
  // Direct-manipulation fast path — used by Reanimated to bypass the
  // Fabric commit for worklet-driven updates. We don't run worklets on
  // the UI thread today, so the next normal commit will pick the props
  // up.
}

void LinuxSchedulerDelegate::schedulerDidUpdateShadowTree(
    const std::unordered_map<facebook::react::Tag, folly::dynamic>& /*tagToProps*/) {
  // Notification that the JS thread directly mutated the shadow tree
  // (Animated.setNativeProps and friends). No-op until we wire those
  // module paths through to the Linux side.
}

} // namespace rnlinux
