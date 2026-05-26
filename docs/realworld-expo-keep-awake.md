# Real-app harness: expo-keep-awake via systemd-logind

`expo-keep-awake` is backed by systemd-logind's
`org.freedesktop.login1.Manager.Inhibit("idle", …, "block")`
on the system bus. Holding the fd that logind returns keeps the
inhibit alive; closing it releases.

## Why logind over org.freedesktop.ScreenSaver

The session-bus `org.freedesktop.ScreenSaver` interface only runs
inside a desktop session — gnome-screensaver, KDE's ksmserver,
mate-screensaver, xscreensaver, etc. logind is system-level and
ships on every systemd install (Ubuntu, Debian, Fedora, Arch,
Pop!\_OS, openSUSE, …), so the inhibit works from headless
sessions, dev VMs, and CI runners without needing a screen-saver
daemon. The contract is the same as expo-keep-awake's: prevent
unattended idle / sleep until released.

## Architecture

```
JS app
  ↓ require('expo-keep-awake')   ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-keep-awake.js
  ├─ activateKeepAwakeAsync(tag)  →  rnLinux.keepAwakeActivate
  ├─ deactivateKeepAwake(tag)     →  rnLinux.keepAwakeDeactivate
  ├─ isAvailableAsync()           →  rnLinux.keepAwakeIsAvailable
  └─ useKeepAwake(tag) hook       →  activate on mount, deactivate on unmount
  ↓
vnext/src/jsi/RnLinuxBindings.cpp                ← JSI bindings
  ↓
vnext/src/keepawake/KeepAwake.cpp                ← logind wrapper
  ↓
g_dbus_connection_call_with_unix_fd_list_sync
  → org.freedesktop.login1.Manager.Inhibit
  → returned fd held in tag→fd map
  → close(fd) releases the inhibit
```

Tag-keyed so multiple overlapping inhibitors (one per active
route, component, etc.) can release independently. Bundle reload
(Fast Refresh) walks the map and closes every held fd so a JS
component that vanished mid-edit doesn't leak an inhibit until
process exit.

## VM / host setup

Nothing. systemd-logind ships with systemd. Lima Ubuntu has it
running on the system bus out of the box.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

Click **keep awake** in the expo-keep-awake section. While
inhibiting, you can verify on the VM host:

```sh
systemd-inhibit --list
# WHO=react-native-linux WHAT=idle WHY="smoke demo" MODE=block
```

Click **release** to drop the inhibit.

## API surface

| API                                     | Behavior on Linux                                                       |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `ExpoKeepAwakeTag`                      | String constant — default tag name                                      |
| `isAvailableAsync()`                    | Real — NameHasOwner('org.freedesktop.login1')                           |
| `activateKeepAwakeAsync(tag, {reason})` | Real — `Manager.Inhibit("idle", "react-native-linux", reason, "block")` |
| `activateKeepAwake(tag)`                | Sync variant — same call without await                                  |
| `deactivateKeepAwake(tag)`              | Real — close(fd) for the tag                                            |
| `useKeepAwake(tag, {reason})`           | React hook — activates on mount, deactivates on unmount                 |

## Known gaps

- **Sleep inhibit needs polkit.** We ask only for `"idle"` —
  enough to keep the display from blanking and the screen-saver
  from engaging. logind requires polkit's
  `org.freedesktop.login1.inhibit-block-sleep` policy for
  non-root `"sleep"` inhibits, which unprivileged user processes
  don't have by default. Adding a polkit rules drop-in
  (`/etc/polkit-1/rules.d/`) would let `activateKeepAwakeAsync`
  prevent system suspend too; for now we only block the
  display-blank / lock-screen path that expo-keep-awake's
  contract actually maps to.
- **Delay vs block mode** — **DONE.** `activateKeepAwakeAsync` /
  `activateKeepAwake` accept an `options.mode` of `"block"` (the
  default, hard inhibit) or `"delay"` (soft — system can proceed
  after a short timeout but the app gets a chance to react
  first). Anything else clamps back to `"block"` since logind
  rejects unknown modes.
- **Inhibitor naming** — **DONE.** `options.who` is threaded
  through to the logind `who` arg so each app surfaces a
  meaningful name in `systemd-inhibit --list`. Falls back to
  `"react-native-linux"` when blank.
- **No equivalent on non-systemd Linux.** Devuan, Void, Alpine
  without elogind, and other systemd-free distros don't run
  `org.freedesktop.login1`. `isAvailableAsync` returns `false`
  there and `activateKeepAwakeAsync` silently no-ops. Future
  improvement: fall back to the session-bus
  `org.freedesktop.ScreenSaver` interface when a desktop session
  is running.
- **No portal path.** Sandboxed apps (Flatpak, Snap) need the
  `org.freedesktop.portal.Inhibit` interface instead. We can add
  a portal fallback when running under `FLATPAK_ID`.
