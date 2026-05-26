#include "KeepAwake.h"

#include "react-native-linux/Logging.h"

#include <gio/gio.h>
#include <gio/gunixfdlist.h>
#include <unistd.h>
#include <unordered_map>

namespace rnlinux::keepawake {

namespace {

// Two release paths so a single tag map can hold either kind of
// inhibit handle without losing how to undo it. logind hands back
// a unix fd (close it → release); org.freedesktop.ScreenSaver
// hands back a uint32 cookie (UnInhibit(cookie) → release).
struct InhibitHandle {
  int fd = -1;        // logind path
  guint32 cookie = 0; // screensaver path
  bool viaScreenSaver = false;
};

struct State {
  std::unordered_map<std::string, InhibitHandle> inhibitors;
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

GDBusConnection* sessionBus() {
  static GDBusConnection* bus = nullptr;
  if (!bus) {
    GError* err = nullptr;
    bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &err);
    if (!bus) {
      RNL_LOGW("rnLinux.keepawake")
          << "session bus unavailable: " << (err && err->message ? err->message : "(unknown)");
      if (err)
        g_error_free(err);
    }
  }
  return bus;
}

// True iff a daemon owns the well-known bus name. Cheap check
// (~1ms) — used by activate() to decide whether to even try
// the logind path before falling back to the session ScreenSaver.
bool nameOwned(GDBusConnection* bus, const char* name) {
  if (!bus)
    return false;
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(bus,
                                                "org.freedesktop.DBus",
                                                "/org/freedesktop/DBus",
                                                "org.freedesktop.DBus",
                                                "NameHasOwner",
                                                g_variant_new("(s)", name),
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

// Last-ditch fallback path for distros without logind / elogind.
// org.freedesktop.ScreenSaver is the session-bus service every
// major DE implements (gnome-session, ksmserver, mate-session,
// xfce4-screensaver, cinnamon-screensaver, etc.) so the inhibit
// works across desktops even when systemd isn't present.
// Returns the cookie on success, 0 on failure.
guint32 screenSaverInhibit(const std::string& who, const std::string& reason) {
  auto* bus = sessionBus();
  if (!bus)
    return 0;
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(
      bus,
      "org.freedesktop.ScreenSaver",
      "/org/freedesktop/ScreenSaver",
      "org.freedesktop.ScreenSaver",
      "Inhibit",
      g_variant_new(
          "(ss)", who.c_str(), reason.empty() ? "App requested keep-awake" : reason.c_str()),
      G_VARIANT_TYPE("(u)"),
      G_DBUS_CALL_FLAGS_NONE,
      2000,
      nullptr,
      &err);
  if (!reply) {
    if (err)
      g_error_free(err);
    return 0;
  }
  guint32 cookie = 0;
  g_variant_get(reply, "(u)", &cookie);
  g_variant_unref(reply);
  return cookie;
}

void screenSaverUnInhibit(guint32 cookie) {
  if (!cookie)
    return;
  auto* bus = sessionBus();
  if (!bus)
    return;
  GError* err = nullptr;
  g_dbus_connection_call_sync(bus,
                              "org.freedesktop.ScreenSaver",
                              "/org/freedesktop/ScreenSaver",
                              "org.freedesktop.ScreenSaver",
                              "UnInhibit",
                              g_variant_new("(u)", cookie),
                              nullptr,
                              G_DBUS_CALL_FLAGS_NONE,
                              500,
                              nullptr,
                              &err);
  if (err)
    g_error_free(err);
}

} // namespace

bool isAvailable() {
  // Either backend will do — logind is preferred for system-level
  // inhibits but org.freedesktop.ScreenSaver is the session-bus
  // fallback for distros without elogind / systemd.
  return nameOwned(systemBus(), "org.freedesktop.login1") ||
         nameOwned(sessionBus(), "org.freedesktop.ScreenSaver");
}

bool activate(const std::string& tag,
              const std::string& reason,
              const std::string& who,
              const std::string& mode) {
  if (tag.empty())
    return false;
  // Idempotent — JS components remount during Fast Refresh and
  // would otherwise leak fds.
  if (state().inhibitors.count(tag))
    return true;

  auto* bus = systemBus();
  if (!bus)
    return false;

  // Inhibit("idle", who, why, mode) — block the idle timer
  // (display blanking, screen lock). We deliberately don't ask
  // for "sleep" inhibit too: logind requires a polkit policy
  // (org.freedesktop.login1.inhibit-block-sleep) for non-root
  // sleep inhibitors and unprivileged user processes get
  // AccessDenied without it. Idle inhibit is the part
  // expo-keep-awake actually maps to — preventing screen blank
  // / lock during long-running tasks — and works for any user.
  //
  // `who` is whatever the caller wants surfaced in
  // `systemd-inhibit --list`; fallback identifies us
  // unambiguously. `mode` is "block" (hard inhibit) or "delay"
  // (soft — system can proceed after a timeout); logind rejects
  // anything else so we clamp.
  const std::string whoArg = who.empty() ? std::string{"react-native-linux"} : who;
  const std::string modeArg = (mode == "delay") ? std::string{"delay"} : std::string{"block"};
  GError* err = nullptr;
  GUnixFDList* fdList = nullptr;
  GVariant* reply = g_dbus_connection_call_with_unix_fd_list_sync(
      bus,
      "org.freedesktop.login1",
      "/org/freedesktop/login1",
      "org.freedesktop.login1.Manager",
      "Inhibit",
      g_variant_new("(ssss)",
                    "idle",
                    whoArg.c_str(),
                    reason.empty() ? "App requested keep-awake" : reason.c_str(),
                    modeArg.c_str()),
      G_VARIANT_TYPE("(h)"),
      G_DBUS_CALL_FLAGS_NONE,
      2000,
      nullptr,
      &fdList,
      nullptr,
      &err);
  if (!reply || !fdList) {
    if (err)
      g_error_free(err);
    if (reply)
      g_variant_unref(reply);
    if (fdList)
      g_object_unref(fdList);
    // logind unavailable / refused — try the session-bus
    // ScreenSaver path. On non-systemd distros (Devuan, Void,
    // Alpine without elogind) this is the only inhibit surface;
    // on systemd boxes with the screensaver service running it's
    // the same idle inhibit logind would have given us.
    const guint32 cookie = screenSaverInhibit(whoArg, reason);
    if (cookie != 0) {
      state().inhibitors[tag] = {-1, cookie, true};
      return true;
    }
    RNL_LOGW("rnLinux.keepawake") << "Inhibit failed on both logind and ScreenSaver";
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
  state().inhibitors[tag] = {fd, 0, false};
  return true;
}

void deactivate(const std::string& tag) {
  auto it = state().inhibitors.find(tag);
  if (it == state().inhibitors.end())
    return;
  if (it->second.viaScreenSaver) {
    screenSaverUnInhibit(it->second.cookie);
  } else if (it->second.fd >= 0) {
    close(it->second.fd);
  }
  state().inhibitors.erase(it);
}

void reset() {
  for (auto& [tag, handle] : state().inhibitors) {
    if (handle.viaScreenSaver) {
      screenSaverUnInhibit(handle.cookie);
    } else if (handle.fd >= 0) {
      close(handle.fd);
    }
  }
  state().inhibitors.clear();
}

} // namespace rnlinux::keepawake
