#pragma once

#include <memory>
#include <react/renderer/scheduler/SchedulerDelegate.h>

namespace rnlinux {

class LinuxMountingManager;

// Linux-side implementation of facebook::react::SchedulerDelegate. The
// Fabric Scheduler hands us mounting coordinators, command dispatches,
// and accessibility events; we forward them to the GTK-side mounting
// manager (which runs on the main loop thread).
//
// All callbacks fire on the JS thread. We marshal across to the UI
// thread via g_idle_add — see LinuxMountingManager.
class LinuxSchedulerDelegate final : public facebook::react::SchedulerDelegate {
 public:
  explicit LinuxSchedulerDelegate(std::shared_ptr<LinuxMountingManager> mm);
  ~LinuxSchedulerDelegate() override;

  void schedulerDidFinishTransaction(
      const std::shared_ptr<const facebook::react::MountingCoordinator>& coordinator) override;
  void schedulerShouldRenderTransactions(
      const std::shared_ptr<const facebook::react::MountingCoordinator>& coordinator) override;
  void schedulerDidRequestPreliminaryViewAllocation(
      const facebook::react::ShadowNode& shadowNode) override;
  void schedulerDidDispatchCommand(const facebook::react::ShadowView& shadowView,
                                   const std::string& commandName,
                                   const folly::dynamic& args) override;
  void schedulerDidSendAccessibilityEvent(const facebook::react::ShadowView& shadowView,
                                          const std::string& eventType) override;
  void schedulerDidSetIsJSResponder(const facebook::react::ShadowView& shadowView,
                                    bool isJSResponder,
                                    bool blockNativeResponder) override;
  // RN 0.81 added these two to the delegate contract. The
  // synchronous-update path is iOS/Android optimisation glue we don't
  // need; the shadow-tree-did-update hook is for direct-manipulation
  // callers (Animated, Reanimated) that we don't drive yet.
  void schedulerShouldSynchronouslyUpdateViewOnUIThread(facebook::react::Tag tag,
                                                        const folly::dynamic& props) override;
  void schedulerDidUpdateShadowTree(
      const std::unordered_map<facebook::react::Tag, folly::dynamic>& tagToProps) override;

 private:
  std::shared_ptr<LinuxMountingManager> mountingManager_;
};

} // namespace rnlinux
