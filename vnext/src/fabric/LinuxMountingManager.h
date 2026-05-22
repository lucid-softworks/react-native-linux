#pragma once

#include <memory>

#include "LinuxComponentViewRegistry.h"

typedef struct _GtkWidget GtkWidget;

namespace facebook::react {
struct MountingTransaction;
}

namespace rnlinux {

// Owns the GTK4 root view and the LinuxComponentViewRegistry. Receives
// mounting transactions from LinuxSchedulerDelegate (already dispatched to
// the GTK main thread) and applies their mutations in order.
class LinuxMountingManager {
 public:
  explicit LinuxMountingManager(GtkWidget* rootView);
  ~LinuxMountingManager();

  // Apply one mounting transaction. Must be called on the GTK main thread.
  void performTransaction(
      const facebook::react::MountingTransaction& transaction);

  GtkWidget* rootView() const { return rootView_; }
  LinuxComponentViewRegistry& registry() { return registry_; }

 private:
  void handleCreate(Tag tag, const std::string& componentName);
  void handleDelete(Tag tag);
  void handleInsert(Tag parentTag, Tag childTag, int index);
  void handleRemove(Tag parentTag, Tag childTag, int index);
  void handleUpdateProps(Tag tag /*, oldProps, newProps */);
  void handleUpdateLayoutMetrics(Tag tag /*, LayoutMetrics */);
  void handleUpdateState(Tag tag /*, state */);
  void handleUpdateEventEmitter(Tag tag /*, ee */);

  GtkWidget* rootView_;
  LinuxComponentViewRegistry registry_;
};

}  // namespace rnlinux
