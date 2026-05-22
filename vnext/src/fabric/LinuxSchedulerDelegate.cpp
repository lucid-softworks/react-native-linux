#include "LinuxSchedulerDelegate.h"
#include "LinuxMountingManager.h"
#include "react-native-linux/Logging.h"

// When wired:
// #include <react/renderer/mounting/MountingCoordinator.h>
// #include <react/renderer/mounting/MountingTransaction.h>

namespace rnlinux {

LinuxSchedulerDelegate::LinuxSchedulerDelegate(
    std::shared_ptr<LinuxMountingManager> mm)
    : mountingManager_(std::move(mm)) {}

LinuxSchedulerDelegate::~LinuxSchedulerDelegate() = default;

void LinuxSchedulerDelegate::onTransaction(
    facebook::react::MountingCoordinator const& /*coordinator*/) {
  // Pull pending transaction off the coordinator and dispatch to GTK on the
  // main thread.
  //
  // TODO:
  //   auto maybeTx = coordinator.pullTransaction();
  //   if (!maybeTx) return;
  //   auto& tx = *maybeTx;
  //   rnlinux::dispatchOnGtkMain([mm = mountingManager_, tx = std::move(tx)] {
  //     mm->performTransaction(tx);
  //   });
  RNL_LOGD("SchedulerDelegate") << "onTransaction (stub)";
}

}  // namespace rnlinux
