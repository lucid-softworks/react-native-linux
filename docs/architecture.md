# Architecture

This document sketches how a React Native app runs on Linux. It assumes you
already understand React Native's New Architecture (Fabric + TurboModules) at
the iOS/Android level — if not, skim
[reactnative.dev/architecture](https://reactnative.dev/architecture/overview)
first.

## Process model

A react-native-linux app is a single OS process. Inside it:

```
┌──────────────────────── main process ────────────────────────┐
│                                                              │
│   ┌─────────── GTK4 UI thread (GMainLoop) ────────────┐      │
│   │  GtkApplication                                   │      │
│   │  └─ GtkApplicationWindow                          │      │
│   │     └─ GtkFixed  (root view; surface mount point) │      │
│   │        └─ LinuxComponentView tree (1 per Tag)     │      │
│   │            ├─ ViewComponentView    → GtkFixed     │      │
│   │            └─ ParagraphComponentView → GtkLabel   │      │
│   └───────────────────────────────────────────────────┘      │
│                          ▲   │                               │
│           mounting txns  │   │ events (pointer/keyboard)     │
│                          │   ▼                               │
│   ┌────────────── JS thread (std::thread) ────────────┐      │
│   │  Hermes runtime  +  facebook::react::ReactInstance│      │
│   │  Fabric Scheduler                                 │      │
│   │  TurboModuleManager  +  CallInvoker              │      │
│   └───────────────────────────────────────────────────┘      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

The two threads communicate via two queues:

- **JS → UI:** `g_idle_add(...)` posts the mutations produced by Fabric onto
  the GTK main loop. The UI thread drains them on the next loop iteration.
- **UI → JS:** `RuntimeExecutor::operator()` (the canonical Fabric API) posts
  work onto the JS thread, which Hermes runs synchronously inside its
  `evaluateJavaScript` loop.

## Bundle loading

`BundleLoader` handles both `file://` and `http(s)://` URLs:

- Dev: Metro is at `http://127.0.0.1:8081/index.bundle?platform=linux&dev=true`.
- Release: `index.linux.bundle` is bundled next to the executable; the host
  loads it via `file://...`.

The env vars `RN_METRO_HOST`, `RN_METRO_PORT`, and `RN_BUNDLE_URL` override
the defaults; this is how the CLI's `run-linux` command points the app at the
right Metro.

## Rendering pipeline

1. JS calls `setState` → React Reconciler produces a new shadow tree.
2. The Fabric Scheduler commits the tree, runs layout (Yoga), and produces a
   `MountingTransaction`.
3. `LinuxSchedulerDelegate::schedulerDidFinishTransaction` is called on the
   Fabric thread. It posts the transaction onto the UI thread.
4. `LinuxMountingManager::performTransaction` iterates the mutations on the UI
   thread and:
   - Creates / deletes `LinuxComponentView` instances via the
     `LinuxComponentViewRegistry`.
   - Wires children into parents via `gtk_fixed_put`.
   - Applies layout from Yoga via `gtk_fixed_move` +
     `gtk_widget_set_size_request`.
   - Applies props via per-widget CSS providers (background, border-radius).
   - Applies state (text contents, attributed string fragments) via Pango.

## Layout

Yoga (bundled with RN) computes the layout. We **do not** use GTK4's flex
machinery — every container is a `GtkFixed` with absolute coordinates so that
Yoga's output applies verbatim.

The downside: GTK accessibility / focus-traversal assumes a hierarchical
container. This works for MVP but will need revisiting for serious a11y.

## Events

| RN concept                         | GTK4 mechanism                               |
| ---------------------------------- | -------------------------------------------- |
| `onPress`                          | `GtkGestureClick` (released)                 |
| `onLongPress`                      | `GtkGestureLongPress` (pressed)              |
| `onHoverIn` / `onHoverOut`         | `GtkEventControllerMotion` (enter / leave)   |
| `onChangeText` / `onSubmitEditing` | `GtkText` (changed / activate)               |
| `onKeyPress`                       | `GtkEventControllerKey` on CAPTURE phase     |
| `onFocus` / `onBlur`               | `GtkEventControllerFocus` (enter / leave)    |
| Touch (rare on desktop)            | Synthesized from pointer; no real multitouch |
| Scroll                             | `GtkAdjustment::value-changed`               |

Each `LinuxComponentView` owns its controllers. Today they dispatch through
ad-hoc `dispatchFabric*(tag, …)` JSI registries keyed by the Fabric tag;
the planned migration to real Fabric `EventEmitter` dispatch is
[design-doc'd](./design-fabric-event-emitter.md).

## Per-app identity (`AppContext`)

The CLI's `init-linux` bakes the consumer's `package.json` name into the
generated `linux/main.cpp` as `cfg.applicationId` (see
[design-multi-instance.md](./design-multi-instance.md)). `RNLinuxApplication`'s
constructor publishes the value via `rnlinux::setApplicationId(...)`;
in-process modules read it back through `rnlinux::applicationId()`.

The accessor is the canonical source for per-app sandbox paths:

- AsyncStorage's JSON file lives at `$XDG_CONFIG_HOME/<applicationId>/async-storage.json`.
- SecureStore tags entries with `<applicationId> [secure-store]: <key>`
  in the user's keyring.
- KeepAwake's logind `Inhibit` call surfaces the id in `systemd-inhibit --list`.
- Notifications passes the id to `notify_init` so gnome-shell / xfce4-notifyd
  attribute bubbles correctly.
- FileSystem's `documentDirectory` / `cacheDirectory` are
  `$XDG_*_HOME/<applicationId>/`.
- DeviceInfo's `bundleId` returns the id (matching iOS / Android shape).

Two installed apps with different `applicationId`s get disjoint state across
all of these.

## TurboModules

Native modules are registered with the `TurboModuleRegistry` at host start —
`globalThis.__turboModuleProxy` looks them up by name (see
`vnext/src/jsi/TurboModuleRegistry.cpp`). The first shipping module is
`PlatformConstants`, which exposes `Platform.OS === 'linux'` and friends.

The remaining ~20 in-tree shims (AsyncStorage, DeviceInfo, Camera,
SecureStore, …) currently surface through ad-hoc `globalThis.rnLinux.*` JSI
bindings rather than TurboModules. The migration to `@react-native/codegen`-
driven TurboModules is [design-doc'd](./design-turbomodule-manager.md).

### Expo modules

Third-party Expo packages from npm look up native modules via
`expo-modules-core`'s `requireNativeModule(name)` / `requireOptionalNativeModule(name)`,
which check `globalThis.expo.modules[name]`. Our umbrella shim
(`packages/@lucid-softworks/react-native-linux-expo/expo-modules-core.js`)
provides this lookup; each in-tree expo-\* shim registers itself via
`registerExpoModule(name, impl)` at module-load time so canonical names
(`ExpoApplication`, `ExpoCamera`, `ExpoHaptics`, etc.) resolve to our
Linux backends transparently.

## Build system

CMake (Ninja generator) drives everything native. Dependencies are fetched
via `FetchContent`:

- Hermes (built from source — RN's vendored tag)
- Folly subset
- glog
- fmt
- double-conversion
- Boost (header-only subset)

GTK4 is pulled from the system via `pkg-config` — building it from source is
not in scope.

The runtime installs as a shared library (`libreact_native_linux.so`) plus a
`react_native_linuxConfig.cmake` so downstream apps consume it via
`find_package(react_native_linux)`.

## What's NOT in scope (yet)

- Native debugger UI beyond Hermes' inspector.
- Multi-window apps. The runtime models a single surface today —
  [design-multi-instance.md](./design-multi-instance.md) Phase 3 covers the
  `SurfaceHandler`-per-window plan.
- Wayland-specific polish (IME, fractional scaling, layer-shell).
- libadwaita styling — phase 10 in [TODO.md](../TODO.md).
