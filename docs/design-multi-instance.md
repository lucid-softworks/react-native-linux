# Migration: single GtkApplication → per-app process + runtime isolation

## Status

Designed. Task #11 in the prod-readiness punch list. Required before
the playground (or any future-installed app) can ship as a "real"
desktop app — today every app shares the same GtkApplication +
Hermes runtime, so two installed apps can't coexist on the user's
machine.

## What we have today

`vnext/src/RNLinuxApplication.cpp` constructs a single `GtkApplication`
with a hard-coded application-id (`config.applicationId`), one
`RNLinuxHost`, one Hermes runtime, and one root surface. The
playground binary embeds this configuration directly — there's no
notion of "many apps each in their own process".

Consequences:

- Two installed apps with the same wrapper code conflict on the
  GtkApplication's D-Bus name → second one fails to register.
- Installing the playground globally and `app A` would mean both
  apps reach for the same `XDG_CONFIG_HOME`-based AsyncStorage path,
  same SecureStore keyring service ID, same logind inhibit tag.
- Crash in one app drops the whole process; no way to keep a sidebar
  / dock running while a heavy demo restarts.

## How react-native-windows / react-native-macos solve this

Both follow the standard platform contract — one app per process,
each with its own application-id (Windows: PackageFamilyName; macOS:
bundle identifier). The shipped binary is the result of "compile the
RN runtime + the app's JS bundle into one executable", not "one
runtime that hosts arbitrary bundles".

Specifically:

- **RNW**: the user's app builds against `Microsoft.ReactNative` and
  ships as a UWP/MSIX package with its own AppId. Multiple installed
  apps coexist because each is a separate package and Windows assigns
  them disjoint sandbox state.
- **RN-macOS**: similar — each app is its own `.app` bundle with its
  own bundle identifier, sandbox container, and Hermes runtime.

There's no shared host process. The platform's normal app-install +
isolation primitives do the work.

## Plan

Three commits, landing in order.

### Phase 1: per-binary application-id from package.json

- The CLI's `init-linux` command writes the user's chosen
  application-id (default: `tld.example.<AppName>`) into both
  `linux/app.desktop` and `linux/CMakeLists.txt` (passed to the binary
  via `-DRNL_APP_ID=…`).
- `RNLinuxApplication`'s constructor reads `RNL_APP_ID` at build time
  and uses it as the GtkApplication name. Per-package storage paths
  (AsyncStorage XDG dir, SecureStore service ID, logind inhibit tag)
  derive from it.
- This is technically already supported (the config object has
  `applicationId`) — what's missing is the CLI-side generation and
  the per-derived-path wiring in the in-tree modules.

### Phase 2: per-app sandbox paths

Sweep every shimmed module to derive its on-disk state path from
`applicationId`:

- `src/storage/AsyncStorage.cpp` → `$XDG_CONFIG_HOME/<appId>/async-storage.json`
- `src/securestore/SecureStore.cpp` → `secret_service_search` with
  `keychainService=<appId>` instead of hard-coded `rn-linux-app`.
- `src/keepawake/KeepAwake.cpp` → logind Inhibit `who=<appId>`.
- `src/notifications/Notifications.cpp` → libnotify category /
  app-name.
- `src/filesystem/FileSystem.cpp` → `documentDirectory` /
  `cacheDirectory` rooted at `$XDG_*_HOME/<appId>/`.
- DeviceInfo's bundle ID returns `applicationId`.

Each is small (1-5 lines of change) but they're scattered. One commit
per module keeps diffs reviewable.

### Phase 3: process-per-window via systemd-style unit (optional)

Once Phase 1 + 2 land, each installed app is its own process with
its own runtime. **Multi-window** support is then a sub-question: do
we run multiple GtkApplicationWindows inside one process (the iOS
model, via `SurfaceHandler`), or one process per window? RNW spawns
one process per window via `IApplicationViewSwitcher`; macOS uses one
process with multiple `NSWindow`s.

Recommendation: **one process per app, multiple windows via
SurfaceHandler within it**. Matches macOS, lower per-window memory
overhead than full process isolation. Crash isolation is "a crashed
app stays crashed, system survives" — same contract every desktop OS
gives.

The plumbing:

- `RNLinuxHost::createSurface` already accepts a surface ID — needs
  a parallel `Surface` per `<NavigationContainer>`.
- `RNLinuxApplication::onActivate` adds the first window; an
  `openWindow` API on the host triggers `gtk_application_window_new`
  for additional ones.
- `RNLinuxHost` doesn't get multi-instance — one Hermes runtime per
  app, shared across that app's windows. (Same as RN on iOS/Android.)

This phase is **optional for shipping**; single-window apps work fine
after Phase 1 + 2.

## Open questions

- **Application-id format**: enforce reverse-DNS (`works.lucidsoft.RNLinuxPlayground`)
  to match GApplication's contract? GApplication actually requires
  this format. The CLI should validate at `init-linux` time.
- **Migration of existing in-tree apps**: the playground hard-codes
  `works.lucidsoft.RNLinuxPlayground`. After Phase 1 it would
  derive from `linux/CMakeLists.txt`'s build-time define — no app
  change required.
- **Flatpak sandboxing**: an installed Flatpak app gets its own
  sandbox automatically — `~/.var/app/<appId>/` paths replace the
  XDG ones. Detect Flatpak at runtime and prefer the sandboxed path
  if present. (Most of the storage helpers already use
  `g_get_user_data_dir()` / `g_get_user_config_dir()`, which return
  the Flatpak-correct path under sandboxing. Verify each one.)

## Effort estimate

- Phase 1 (per-binary application-id): 2 days. Mostly CLI work.
- Phase 2 (per-app sandbox paths): 1 day per module × ~10 modules =
  ~10 days, but each is parallelizable.
- Phase 3 (multi-window via SurfaceHandler): 5-7 days. Touches
  RNLinuxHost, RNLinuxApplication, and the JS-side fabric
  router (`Linking.openURL` → "open window for X").

Total: ~3-4 weeks. Phase 1 + 2 alone are enough to ship installable
apps; Phase 3 is the polish.

## Out of scope

- **Hot app-bundle swapping**: replacing the running app's JS bundle
  from another app's `Linking.openURL`. That's an upstream `Expo
development-build` problem and doesn't affect the per-app process
  model.
- **System-tray apps**: libayatana-appindicator integration is a
  separate stretch goal listed in the main roadmap; doesn't depend on
  this work.
