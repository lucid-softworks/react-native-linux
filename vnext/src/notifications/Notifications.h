#pragma once

// libnotify-backed local notifications for `expo-notifications`.
//
// Linux's notification model is a freedesktop spec (org.freedesktop
// .Notifications on the session bus) implemented by whichever
// daemon the desktop session runs — gnome-shell, mako, dunst,
// xfce4-notifyd, etc. libnotify is the standard C client and the
// path the rest of the GNOME stack uses. We never talk to the bus
// directly here: that's the daemon's job.
//
// Scheduling is in-process: a g_timeout source per scheduled
// notification, keyed by JS-supplied id so cancellation is O(log n).
// Persistence across app restarts isn't implemented (the daemon
// itself manages active-notification state once we hand one over;
// scheduled but un-fired notifications are lost on quit, matching
// how upstream describes the lower bound of the API).

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace rnlinux::notifications {

struct ScheduledHandle {
  std::string id;
  std::string title;
  std::string body;
  int64_t fireAtMs = 0; // absolute time, ms-epoch
};

// One actionable button on a presented notification. `key` is the
// action id reported back via the response callback when the user
// clicks it. `label` is what the daemon shows on the button.
struct CategoryAction {
  std::string key;
  std::string label;
};

// Response callback: fires when a presented notification is dismissed
// or its default action is taken. The actionId is "default" for a
// plain click, "dismissed" when the user closes without action, or
// the action key for a category-action click (future).
using ResponseCallback = std::function<void(const std::string& id, const std::string& actionId)>;

// One-shot init — safe to call repeatedly; only the first call hits
// notify_init(). `appName` ends up in the notification daemon's
// origin column.
bool ensureInit(const std::string& appName);

// Present a notification immediately. Returns false on libnotify
// error. The id is stored so cancel(id) can close the visible
// bubble later. `categoryId` (when non-empty) looks up actions
// registered via setCategory() and attaches them to the bubble as
// libnotify action buttons.
bool present(const std::string& id,
             const std::string& title,
             const std::string& body,
             const std::string& categoryId = {});

// Schedule a present() call after `delayMs`. The timer fires on the
// main GMainContext; cancellation removes the timer source. If the
// id is already scheduled, the previous schedule is replaced.
bool schedule(const std::string& id,
              int delayMs,
              const std::string& title,
              const std::string& body,
              const std::string& categoryId = {});

// Register / clear a category. Categories carry action button
// definitions that get added to the libnotify bubble at fire time.
// Empty actions or an unknown category id mean a plain
// notification with no buttons. listCategories() exists so the
// shim can answer expo's getNotificationCategoriesAsync.
void setCategory(const std::string& id, std::vector<CategoryAction> actions);
void clearCategory(const std::string& id);
std::vector<std::string> listCategoryIds();
std::vector<CategoryAction> getCategoryActions(const std::string& id);

// Cancel a scheduled-but-unfired notification AND close any
// presently-visible bubble with the same id. Idempotent.
void cancel(const std::string& id);
void cancelAll();

// Snapshot of pending schedules (scheduled but not yet fired). Used
// by expo-notifications' getAllScheduledNotificationsAsync.
std::vector<ScheduledHandle> listScheduled();

// Install the JS-side response handler. Only one is supported; a
// second call replaces it. Pass an empty function (== nullptr-like
// shared_ptr) to clear.
void setResponseCallback(ResponseCallback cb);

// Reset all state — used by the bundle reload path so a fresh JS
// runtime doesn't inherit handlers pointing into a dead Hermes.
void reset();

} // namespace rnlinux::notifications
