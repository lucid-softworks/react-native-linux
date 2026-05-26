#include "Notifications.h"

#include "react-native-linux/Logging.h"

#include <glib.h>
#include <libnotify/notify.h>
#include <mutex>
#include <unordered_map>

namespace rnlinux::notifications {

namespace {

struct Pending {
  // Visible bubble, NULL until present() / fired schedule. Owned by
  // libnotify (refcounted via g_object_*); we hold one ref while it
  // lives, drop it on cancel/close.
  NotifyNotification* visible = nullptr;
  // Scheduled-but-unfired source id from g_timeout_add. 0 if either
  // already fired or never scheduled (plain present).
  guint timerSource = 0;
  std::string title;
  std::string body;
  int64_t fireAtMs = 0;
};

struct State {
  std::unordered_map<std::string, Pending> entries;
  ResponseCallback response;
};

State& state() {
  static State s;
  return s;
}

std::once_flag initOnce_;
bool initOk_ = false;

void onClosed(NotifyNotification* /*n*/, gpointer userData) {
  // We pass a heap-allocated copy of the id so the callback survives
  // the notification's lifetime (libnotify may free the closure
  // after the signal fires).
  auto* idPtr = static_cast<std::string*>(userData);
  if (!idPtr)
    return;
  if (auto& cb = state().response) {
    cb(*idPtr, "dismissed");
  }
  // The Pending entry's `visible` may still hold this notification;
  // drop our ref so libnotify can finalize it. We don't erase the
  // entry yet — cancel(id) may still be called and should be a no-op
  // rather than crash on a missing key.
  auto it = state().entries.find(*idPtr);
  if (it != state().entries.end() && it->second.visible) {
    g_object_unref(it->second.visible);
    it->second.visible = nullptr;
  }
}

// Free the id we leaked into the signal closure, only once the
// notification object is finalized. notify-bound destroy notify.
void freeIdData(gpointer data, GClosure* /*closure*/) {
  delete static_cast<std::string*>(data);
}

bool fire(const std::string& id, const std::string& title, const std::string& body) {
  if (!initOk_)
    return false;
  // Keep the entry; replace its visible field. If the id has a stale
  // visible bubble, close it first so the daemon shows the new one.
  auto& entry = state().entries[id];
  if (entry.visible) {
    GError* err = nullptr;
    notify_notification_close(entry.visible, &err);
    if (err)
      g_error_free(err);
    g_object_unref(entry.visible);
    entry.visible = nullptr;
  }
  entry.title = title;
  entry.body = body;

  NotifyNotification* n = notify_notification_new(title.c_str(), body.c_str(), nullptr);
  if (!n) {
    RNL_LOGE("rnLinux.notif") << "notify_notification_new returned null";
    return false;
  }
  notify_notification_set_app_name(n, "react-native-linux");

  // Use g_signal_connect_data so we can attach a per-handler destroy
  // notify that frees the heap-id when the closure is released. The
  // user_data pointer outlives the call: libnotify keeps the
  // notification (and thus its closures) alive until the bubble
  // dismisses on its own.
  auto* idPtr = new std::string(id);
  g_signal_connect_data(
      n, "closed", G_CALLBACK(onClosed), idPtr, freeIdData, static_cast<GConnectFlags>(0));

  GError* err = nullptr;
  const gboolean ok = notify_notification_show(n, &err);
  if (!ok) {
    RNL_LOGE("rnLinux.notif") << "notify_notification_show failed: "
                              << (err && err->message ? err->message : "(unknown)");
    if (err)
      g_error_free(err);
    g_object_unref(n);
    return false;
  }
  entry.visible = n; // hold our ref so cancel can close it
  return true;
}

} // namespace

bool ensureInit(const std::string& appName) {
  std::call_once(initOnce_, [&]() {
    if (notify_init(appName.empty() ? "react-native-linux" : appName.c_str())) {
      initOk_ = true;
    } else {
      RNL_LOGE("rnLinux.notif") << "notify_init failed";
    }
  });
  return initOk_;
}

bool present(const std::string& id, const std::string& title, const std::string& body) {
  if (!ensureInit("react-native-linux"))
    return false;
  return fire(id, title, body);
}

namespace {

struct TimerCtx {
  std::string id;
};

gboolean onTimerFire(gpointer userData) {
  auto* ctx = static_cast<TimerCtx*>(userData);
  auto it = state().entries.find(ctx->id);
  if (it != state().entries.end()) {
    fire(ctx->id, it->second.title, it->second.body);
    it->second.timerSource = 0; // consumed
  }
  delete ctx;
  return G_SOURCE_REMOVE;
}

} // namespace

bool schedule(const std::string& id,
              int delayMs,
              const std::string& title,
              const std::string& body) {
  if (!ensureInit("react-native-linux"))
    return false;
  if (delayMs < 0)
    delayMs = 0;
  // Replace any existing schedule for this id.
  cancel(id);
  auto& entry = state().entries[id];
  entry.title = title;
  entry.body = body;
  entry.fireAtMs = static_cast<int64_t>(g_get_real_time() / 1000) + static_cast<int64_t>(delayMs);
  auto* ctx = new TimerCtx{id};
  entry.timerSource = g_timeout_add(static_cast<guint>(delayMs), onTimerFire, ctx);
  return true;
}

void cancel(const std::string& id) {
  auto it = state().entries.find(id);
  if (it == state().entries.end())
    return;
  if (it->second.timerSource) {
    g_source_remove(it->second.timerSource);
    it->second.timerSource = 0;
  }
  if (it->second.visible) {
    GError* err = nullptr;
    notify_notification_close(it->second.visible, &err);
    if (err)
      g_error_free(err);
    g_object_unref(it->second.visible);
    it->second.visible = nullptr;
  }
  state().entries.erase(it);
}

void cancelAll() {
  // Snapshot keys first — cancel() mutates the map.
  std::vector<std::string> ids;
  ids.reserve(state().entries.size());
  for (const auto& [k, _] : state().entries)
    ids.push_back(k);
  for (const auto& k : ids)
    cancel(k);
}

std::vector<ScheduledHandle> listScheduled() {
  std::vector<ScheduledHandle> out;
  out.reserve(state().entries.size());
  for (const auto& [id, p] : state().entries) {
    if (p.timerSource != 0) {
      out.push_back({id, p.title, p.body, p.fireAtMs});
    }
  }
  return out;
}

void setResponseCallback(ResponseCallback cb) {
  state().response = std::move(cb);
}

void reset() {
  cancelAll();
  state().response = nullptr;
}

} // namespace rnlinux::notifications
