#pragma once

#include <memory>

namespace facebook::react {
class ShadowNode;
class ShadowTree;
class MountingCoordinator;
struct MountingTransaction;
}  // namespace facebook::react

namespace rnlinux {

class LinuxMountingManager;

// Implements facebook::react::SchedulerDelegate. The Scheduler hands us:
//   - finished mounting transactions to apply on the UI thread
//   - command dispatch requests (e.g. focus())
//   - shadow-tree updates for inspector-style tooling
//
// We forward mounting work to a LinuxMountingManager which talks to GTK.
class LinuxSchedulerDelegate {
 public:
  explicit LinuxSchedulerDelegate(std::shared_ptr<LinuxMountingManager> mm);
  ~LinuxSchedulerDelegate();

  // Called by the Scheduler when a transaction is ready. Implemented as a
  // free-standing method here; the SchedulerDelegate adapter (TBD) forwards.
  void onTransaction(facebook::react::MountingCoordinator const& coordinator);

 private:
  std::shared_ptr<LinuxMountingManager> mountingManager_;
};

}  // namespace rnlinux
