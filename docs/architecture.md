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

| RN concept              | GTK4 mechanism                               |
| ----------------------- | -------------------------------------------- |
| `onPressIn` / `onPress` | `GtkGestureClick`                            |
| `onLongPress`           | `GtkGestureLongPress`                        |
| Touch (rare on desktop) | Synthesized from pointer; no real multitouch |
| `onKeyDown` / `onKeyUp` | `GtkEventControllerKey`                      |
| Scroll                  | `GtkEventControllerScroll`                   |

Each `LinuxComponentView` owns its controllers and forwards events to the
`EventEmitter` provided by Fabric, which posts them onto the JS thread.

## TurboModules

Native modules are registered with the `TurboModuleManager` at host start.
The first shipping module is `PlatformConstants`, which exposes
`Platform.OS === 'linux'` and friends.

The spec lives in
`packages/react-native-linux/Libraries/Specs/NativePlatformConstantsLinux.ts`
and is consumed by `@react-native/codegen` to produce a C++ header that
`vnext/src/modules/PlatformConstants.cpp` implements.

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

- Hot Module Replacement (just full reload via Metro WS).
- Native debugger UI beyond Hermes' inspector.
- Multi-window apps. The runtime models a single surface today.
- Wayland-specific polish (IME, fractional scaling, layer-shell).
- libadwaita styling — phase 10 in [TODO.md](../TODO.md).
