#pragma once

// systemd-logind backed `expo-keep-awake`. We call
// org.freedesktop.login1.Manager.Inhibit(what="idle", mode="block")
// on the system bus and hold onto the returned fd — closing it
// releases the inhibit. Per-tag map so the JS layer can have
// multiple overlapping inhibitors (one per route, component, …)
// and they release independently.
//
// Why not org.freedesktop.ScreenSaver? Session-bus screen-savers
// only run inside a desktop session — gnome-screensaver, KDE's
// ksmserver, xscreensaver, mate-screensaver. logind is system-
// level on every systemd install (everything Ubuntu derivatives,
// Fedora, Debian, Arch), and the JS contract — "don't go idle" —
// is identical.

#include <string>

namespace rnlinux::keepawake {

// True if org.freedesktop.login1 owns its name on the system bus.
// Cheap (single NameHasOwner call); safe to call any time.
bool isAvailable();

// Acquire an idle-inhibit handle and tag it. Idempotent per tag —
// a second call with the same tag reuses the existing fd. Returns
// false if logind isn't reachable or the inhibit call failed.
bool activate(const std::string& tag, const std::string& reason);

// Release the inhibit for `tag`. Closing the fd is the release
// signal logind watches for; we then drop the tag from our map.
// No-op if the tag was never activated.
void deactivate(const std::string& tag);

// Drop every active inhibit. Used at bundle-reload time so a Fast
// Refresh that drops the JS component holding the tag doesn't
// leak an inhibit until process exit.
void reset();

} // namespace rnlinux::keepawake
