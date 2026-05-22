#include "LinuxMountingManager.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>

// When wired:
// #include <react/renderer/mounting/MountingTransaction.h>
// #include <react/renderer/mounting/ShadowViewMutation.h>

namespace rnlinux {

LinuxMountingManager::LinuxMountingManager(GtkWidget* rootView)
    : rootView_(rootView) {}

LinuxMountingManager::~LinuxMountingManager() = default;

void LinuxMountingManager::performTransaction(
    const facebook::react::MountingTransaction& /*tx*/) {
  // TODO: iterate tx.getMutations() and dispatch each to the handler below.
  // Mutation types in Fabric:
  //   - Create        →  handleCreate(mutation.newChildShadowView)
  //   - Delete        →  handleDelete(mutation.oldChildShadowView.tag)
  //   - Insert        →  handleInsert(parentTag, childTag, index)
  //   - Remove        →  handleRemove(parentTag, childTag, index)
  //   - Update        →  props / state / layoutMetrics / eventEmitter
  //   - RemoveDelete  →  combined Remove + Delete (RN 0.74+)
  RNL_LOGD("MountingManager") << "performTransaction (stub)";
}

void LinuxMountingManager::handleCreate(Tag tag, const std::string& componentName) {
  auto view = registry_.create(componentName, tag);
  if (!view) return;
  registry_.insert(std::move(view));
}

void LinuxMountingManager::handleDelete(Tag tag) {
  registry_.take(tag);  // releases the view + unparents the widget via dtor
}

void LinuxMountingManager::handleInsert(Tag parentTag, Tag childTag, int index) {
  auto* parent = parentTag == 0 ? nullptr : registry_.lookup(parentTag);
  auto* child = registry_.lookup(childTag);
  if (!child) return;
  if (parent) {
    parent->mountChild(*child, index);
  } else if (GTK_IS_FIXED(rootView_) && child->widget()) {
    // Top-level surface insertion goes directly under the root GtkFixed.
    gtk_fixed_put(GTK_FIXED(rootView_), child->widget(), 0, 0);
  }
}

void LinuxMountingManager::handleRemove(Tag parentTag, Tag childTag, int index) {
  auto* parent = parentTag == 0 ? nullptr : registry_.lookup(parentTag);
  auto* child = registry_.lookup(childTag);
  if (!child) return;
  if (parent) {
    parent->unmountChild(*child, index);
  } else if (GTK_IS_FIXED(rootView_) && child->widget()) {
    gtk_fixed_remove(GTK_FIXED(rootView_), child->widget());
  }
}

void LinuxMountingManager::handleUpdateProps(Tag /*tag*/) {
  // TODO: registry_.lookup(tag)->updateProps(oldProps, newProps);
}

void LinuxMountingManager::handleUpdateLayoutMetrics(Tag /*tag*/) {
  // TODO: registry_.lookup(tag)->updateLayoutMetrics(metrics);
}

void LinuxMountingManager::handleUpdateState(Tag /*tag*/) {
  // TODO: registry_.lookup(tag)->updateState(state);
}

void LinuxMountingManager::handleUpdateEventEmitter(Tag /*tag*/) {
  // TODO: registry_.lookup(tag)->updateEventEmitter(ee);
}

}  // namespace rnlinux
