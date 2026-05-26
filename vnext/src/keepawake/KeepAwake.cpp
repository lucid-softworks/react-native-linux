#include "KeepAwake.h"

#include "react-native-linux/Logging.h"

#include <gio/gio.h>
#include <gio/gunixfdlist.h>
#include <unistd.h>
#include <unordered_map>

namespace rnlinux::keepawake {

namespace {

struct State {
  // tag → fd held open. Closing the fd is what releases the
  // logind inhibit; we keep it stashed here so JS layers can
  // activate/deactivate without round-tripping through their own
  // bookkeeping.
  std::unordered_map<std::string, int> inhibitors;
};

State& state() {
  static State s;
  return s;
}

GDBusConnection* systemBus() {
  static GDBusConnection* bus = nullptr;
  if (!bus) {
    GError* err = nullptr;
    bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, nullptr, &err);
    if (!bus) {
      RNL_LOGW("rnLinux.keepawake")
          << "system bus unavailable: " << (err && err->message ? err->message : "(unknown)");
      if (err)
        g_error_free(err);
    }
  }
  return bus;
}

} // namespace

bool isAvailable() {
  auto* bus = systemBus();
  if (!bus)
    return false;
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(bus,
                                                "org.freedesktop.DBus",
                                                "/org/freedesktop/DBus",
                                                "org.freedesktop.DBus",
                                                "NameHasOwner",
                                                g_variant_new("(s)", "org.freedesktop.login1"),
                                                G_VARIANT_TYPE("(b)"),
                                                G_DBUS_CALL_FLAGS_NONE,
                                                500,
                                                nullptr,
                                                &err);
  bool owned = false;
  if (reply) {
    gboolean v = FALSE;
    g_variant_get(reply, "(b)", &v);
    owned = v;
    g_variant_unref(reply);
  }
  if (err)
    g_error_free(err);
  return owned;
}

bool activate(const std::string& tag, const std::string& reason) {
  if (tag.empty())
    return false;
  // Idempotent — JS components remount during Fast Refresh and
  // would otherwise leak fds.
  if (state().inhibitors.count(tag))
    return true;

  auto* bus = systemBus();
  if (!bus)
    return false;

  // Inhibit("idle:sleep", who, why, "block") — block both the
  // idle timer (display blanking, screen lock) AND a "suspend
  // when user closes the lid" event. The system can still
  // suspend on explicit user request; we just stop unattended
  // sleep / blank for app-foreground reasons.
  GError* err = nullptr;
  GUnixFDList* fdList = nullptr;
  GVariant* reply = g_dbus_connection_call_with_unix_fd_list_sync(
      bus,
      "org.freedesktop.login1",
      "/org/freedesktop/login1",
      "org.freedesktop.login1.Manager",
      "Inhibit",
      g_variant_new("(ssss)",
                    "idle:sleep",
                    "react-native-linux",
                    reason.empty() ? "App requested keep-awake" : reason.c_str(),
                    "block"),
      G_VARIANT_TYPE("(h)"),
      G_DBUS_CALL_FLAGS_NONE,
      2000,
      nullptr,
      &fdList,
      nullptr,
      &err);
  if (!reply || !fdList) {
    RNL_LOGW("rnLinux.keepawake") << "Inhibit failed: "
                                  << (err && err->message ? err->message : "(unknown)");
    if (err)
      g_error_free(err);
    if (reply)
      g_variant_unref(reply);
    if (fdList)
      g_object_unref(fdList);
    return false;
  }
  // Reply carries the fd index in the message's fd list; pull
  // the actual fd via g_unix_fd_list_get and keep it open. logind
  // releases the inhibit only when the last reference to the fd
  // closes — which happens when we explicitly close() in
  // deactivate(), reset(), or at process exit.
  gint32 handleIdx = 0;
  g_variant_get(reply, "(h)", &handleIdx);
  GError* fdErr = nullptr;
  int fd = g_unix_fd_list_get(fdList, handleIdx, &fdErr);
  g_variant_unref(reply);
  g_object_unref(fdList);
  if (fd < 0) {
    RNL_LOGW("rnLinux.keepawake") << "fd list get failed: "
                                  << (fdErr && fdErr->message ? fdErr->message : "(unknown)");
    if (fdErr)
      g_error_free(fdErr);
    return false;
  }
  state().inhibitors[tag] = fd;
  return true;
}

void deactivate(const std::string& tag) {
  auto it = state().inhibitors.find(tag);
  if (it == state().inhibitors.end())
    return;
  if (it->second >= 0)
    close(it->second);
  state().inhibitors.erase(it);
}

void reset() {
  for (auto& [tag, fd] : state().inhibitors) {
    if (fd >= 0)
      close(fd);
  }
  state().inhibitors.clear();
}

} // namespace rnlinux::keepawake
