#include "LinuxMountingManager.h"

#include "react-native-linux/Logging.h"

#include <algorithm>
#include <gtk/gtk.h>
#include <react/renderer/mounting/MountingTransaction.h>
#include <react/renderer/mounting/ShadowView.h>
#include <react/renderer/mounting/ShadowViewMutation.h>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace rnlinux {

namespace {
struct UpdatePropsStats {
  int count = 0;
  gint64 totalUs = 0;
  gint64 maxUs = 0;
};
// Per-component updateProps profile, keyed by componentName. Logged
// alongside the per-transaction roll-up so the line shows which view
// classes (Text, Image, ScrollView, …) are dominating mount cost on a
// given screen.
std::unordered_map<std::string, UpdatePropsStats>& updatePropsStats() {
  static std::unordered_map<std::string, UpdatePropsStats> m;
  return m;
}
} // namespace

LinuxMountingManager::LinuxMountingManager(GtkWidget* rootView)
    : rootView_(rootView) {}

LinuxMountingManager::~LinuxMountingManager() = default;

void LinuxMountingManager::performTransaction(const facebook::react::MountingTransaction& tx) {
  const auto& mutations = tx.getMutations();
  RNL_LOGD("MountingManager") << "performTransaction (" << mutations.size() << " mutations)";
  // Lightweight per-transaction profiling — surface average + max wall
  // time over the last N transactions so we can see if the mount is
  // dominating frame time. Wrapped in a static so it survives reloads.
  struct Profile {
    int count = 0;
    gint64 totalUs = 0;
    gint64 maxUs = 0;
  };
  static Profile prof;
  const gint64 t0 = g_get_monotonic_time();

  // Mutations come pre-sorted by Fabric: Deletes first, then Creates,
  // Inserts, Updates, Removes. We replay them in order.
  for (const auto& m : mutations) {
    using Type = facebook::react::ShadowViewMutation::Type;
    switch (m.type) {
    case Type::Create:
      handleCreate(m.newChildShadowView.tag, m.newChildShadowView.componentName);
      // Apply initial props + state on create so the widget is ready
      // before it's inserted. Layout still has to wait for Insert.
      handleUpdate(m.newChildShadowView, m.newChildShadowView);
      break;

    case Type::Delete:
      handleDelete(m.oldChildShadowView.tag);
      break;

    case Type::Insert:
      handleInsert(m.parentTag, m.newChildShadowView.tag, m.index);
      // Layout/position can only be applied once the child is in a
      // GtkFixed parent — do it here.
      applyLayout(m.newChildShadowView);
      break;

    case Type::Remove:
      handleRemove(m.parentTag, m.oldChildShadowView.tag, m.index);
      break;

    case Type::Update:
      handleUpdate(m.oldChildShadowView, m.newChildShadowView);
      applyLayout(m.newChildShadowView);
      break;
    }
  }

  // Now that every Create/Insert/Update has run and every view has its
  // post-layout position+size set, give component views a chance to
  // observe the final state of their subtree. ScrollView uses this to
  // size its inner GtkFixed to the children's bounding box — it can't
  // do that during the per-mutation pass because children are inserted
  // AFTER their parent receives applyLayout.
  for (const auto& [tag, view] : registry_.views()) {
    view->postLayoutPass();
  }

  const gint64 elapsed = g_get_monotonic_time() - t0;
  prof.count++;
  prof.totalUs += elapsed;
  if (elapsed > prof.maxUs)
    prof.maxUs = elapsed;
  // Roll up every 60 transactions (~1 s of busy state). Logging on
  // every txn would itself slow us down.
  if (prof.count >= 60) {
    RNL_LOGI("MountingManager.prof") << "n=" << prof.count << " avg=" << (prof.totalUs / prof.count)
                                     << "us" << " max=" << prof.maxUs << "us";
    // Roll up per-component updateProps cost. Sorting by total time
    // (count * avg) puts the worst offenders first; only the top 6
    // get logged so a screen with 20+ component types stays readable.
    auto& stats = updatePropsStats();
    if (!stats.empty()) {
      std::vector<std::pair<std::string, UpdatePropsStats>> ranked(stats.begin(), stats.end());
      std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) {
        return a.second.totalUs > b.second.totalUs;
      });
      std::ostringstream line;
      line << "updateProps roll-up:";
      const std::size_t top = std::min<std::size_t>(6, ranked.size());
      for (std::size_t i = 0; i < top; ++i) {
        const auto& [name, s] = ranked[i];
        line << " " << name << "(n=" << s.count << ",avg=" << (s.totalUs / s.count)
             << "us,max=" << s.maxUs << "us)";
      }
      RNL_LOGI("MountingManager.prof") << line.str();
      stats.clear();
    }
    prof = {};
  }
}

void LinuxMountingManager::handleCreate(Tag tag, const std::string& componentName) {
  if (registry_.lookup(tag)) {
    RNL_LOGW("MountingManager") << "Create for tag " << tag << " (" << componentName
                                << ") — already exists; ignoring";
    return;
  }
  auto view = registry_.create(componentName, tag);
  if (!view) {
    // RawText is data-only; the registry returns nullptr by design.
    return;
  }
  registry_.insert(std::move(view));
}

void LinuxMountingManager::handleDelete(Tag tag) {
  // Drop the registry entry — the GtkWidget destructor in the
  // LinuxComponentView base class unparents the widget, which lets GTK
  // refcounting reclaim it.
  registry_.take(tag);
}

void LinuxMountingManager::handleInsert(Tag parentTag, Tag childTag, int index) {
  auto* child = registry_.lookup(childTag);
  if (!child)
    return; // RawText or unknown component
  auto* parent = parentTag == 0 ? nullptr : registry_.lookup(parentTag);
  GtkWidget* widget = child->widget();
  if (parent) {
    parent->mountChild(*child, index);
  } else if (GTK_IS_FIXED(rootView_) && widget) {
    // The Fabric "surface root" lives at a parentTag we don't mount
    // a LinuxComponentView for — that's the RootShadowNode itself.
    // Anything claiming it as parent gets attached to the GTK root.
    gtk_fixed_put(GTK_FIXED(rootView_), widget, 0, 0);
  }
}

void LinuxMountingManager::handleRemove(Tag parentTag, Tag childTag, int /*index*/) {
  auto* child = registry_.lookup(childTag);
  if (!child)
    return;
  auto* parent = parentTag == 0 ? nullptr : registry_.lookup(parentTag);
  if (parent) {
    parent->unmountChild(*child, /*index=*/0);
  } else if (GTK_IS_FIXED(rootView_) && child->widget()) {
    gtk_fixed_remove(GTK_FIXED(rootView_), child->widget());
  }
}

void LinuxMountingManager::handleUpdate(const facebook::react::ShadowView& oldView,
                                        const facebook::react::ShadowView& newView) {
  auto* view = registry_.lookup(newView.tag);
  // Per-update logging was useful during the React 19 reconciler bring-
  // up but it fires for every node in the affected subtree on every
  // commit — a single keystroke into a TextInput inside akari's auth
  // screen logged ~50 lines per character, and each line is a sync
  // write that shows up as typing lag. Keep it under RNL_LOGD so the
  // info is still grep-able in debug builds.
  RNL_LOGD("MountingManager") << "handleUpdate tag=" << newView.tag
                              << " comp=" << newView.componentName
                              << " view=" << (view ? "ok" : "NULL")
                              << " state=" << (newView.state ? "yes" : "no");
  if (!view)
    return;
  const gint64 propsT0 = g_get_monotonic_time();
  if (oldView.props && newView.props && oldView.props != newView.props) {
    view->updateProps(*oldView.props, *newView.props);
  } else if (newView.props) {
    view->updateProps(*newView.props, *newView.props);
  }
  const gint64 propsElapsed = g_get_monotonic_time() - propsT0;
  auto& s = updatePropsStats()[newView.componentName];
  s.count++;
  s.totalUs += propsElapsed;
  if (propsElapsed > s.maxUs)
    s.maxUs = propsElapsed;
  if (newView.state) {
    view->updateState(*newView.state);
  }
  if (newView.eventEmitter) {
    view->updateEventEmitter(newView.eventEmitter);
  }
}

void LinuxMountingManager::applyLayout(const facebook::react::ShadowView& view) {
  auto* lv = registry_.lookup(view.tag);
  if (!lv)
    return;
  lv->updateLayoutMetrics(view.layoutMetrics);
}

} // namespace rnlinux
