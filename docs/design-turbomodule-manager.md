# Migration: ad-hoc `rnLinux.*` bindings → TurboModule manager + codegen

## Status

Designed; partial scaffold already in tree. Picking this up is task #9
in the prod-readiness punch list. Required before any third-party RN
package with native code (`NetInfo`, `MMKV`, `sentry-react-native`,
`react-native-mmkv`, FBSDK, etc.) can autolink — this is the single
biggest unblock for the project.

## What we have today

- `vnext/include/react-native-linux/TurboModuleRegistry.h` — `TurboModule`
  base (a `jsi::HostObject`), a process-wide registry of
  `TurboModuleFactory`, and `installTurboModuleBinding(rt)` which
  installs `globalThis.__turboModuleProxy`. JS-side `TurboModuleRegistry.get(name)`
  flows through `__turboModuleProxy(name)` → registry lookup → cached
  factory invocation.
- `packages/@lucid-softworks/cli/src/commands/autolinkLinux.ts` —
  walks `ctx.dependencies` looking for `platforms.linux` config and
  emits `linux/build/autolinked.cmake` that `add_subdirectory`s each
  one and appends its CMake target to `RN_LINUX_AUTOLINKED_TARGETS`.
- All shipped modules currently use the **ad-hoc** path: a JSI binding
  registered as `globalThis.rnLinux.<name>` (see
  `vnext/src/jsi/RnLinuxBindings.cpp`). That's how AsyncStorage,
  DeviceInfo, Location, Camera, SecureStore, Network, etc. all surface
  themselves. None of them register through `TurboModuleRegistry`.

## How react-native-windows / react-native-macos solve this

Both consume the upstream `@react-native/codegen` pipeline:

- **Codegen** runs against any package whose `package.json` has a
  `codegenConfig` (or against the app itself for in-tree specs). It
  reads `NativeFoo.ts` TypeScript declarations and emits
  `NativeFooSpecJSI.h/cpp` containing an abstract
  `NativeFooCxxSpec` base class with one pure-virtual per method, plus
  JSI marshalling boilerplate.
- **Platform-specific TurboModule shells** subclass the codegen base
  and implement the methods using platform APIs (UIKit on iOS, WinRT
  on Windows, GTK4/GLib on Linux).
- **Autolink** discovers them via `platforms.<platform>` in
  `react-native.config.js`. On Windows the generated code is a C++
  `MakeTurboModuleProvider` registration; on macOS, an ObjC++
  module list passed to `RCTTurboModuleManager`.
- **Manager (`TurboModuleManager`)** is the platform-side host that
  receives `__turboModuleProxy(name)` lookups, asks each registered
  provider whether they own the module, instantiates on first access,
  and caches per-runtime.

We already have the proxy and the registry. What we lack is the
codegen integration and the per-module shell pattern.

## Plan

Four commits, landing in order.

### Phase 1: codegen target

- Wire `@react-native/codegen` into `vnext/cmake/Codegen.cmake` so it
  runs against `packages/@lucid-softworks/react-native-linux/codegen/`
  - every `--platform linux` package the app autolinks.
- Default to the `cxx` platform output (`generateModulePlatformH` /
  `generateModuleSpecH`) — it's already platform-neutral and matches
  what RN's own CxxModule path uses.
- Emit into `vnext/build/codegen/<pkg>/` and add to
  `RNL_RN_RENDERER_SOURCES`. (The existing `Codegen.cmake` already
  runs codegen for component specs — extending to module specs is a
  matter of passing `--type modules` and consuming the generated
  `<Pkg>SpecJSI.{h,cpp}`.)

### Phase 2: TurboModuleManager + registration glue

- New `vnext/src/jsi/TurboModuleManager.{h,cpp}` (subsumes the current
  `TurboModuleRegistry`). Each linked module exposes
  `extern "C" std::shared_ptr<TurboModule> RNLinuxModuleProviderFor<Pkg>(jsi::Runtime&, const std::string& name)`.
  Autolink generates a `RNLinuxModuleProviders.cpp` that lists every
  linked package's `RNLinuxModuleProviderFor*` and the manager walks
  the list until one returns non-null.
- On Manager construction, also register the in-tree shims (today's
  AsyncStorage, DeviceInfo, Location, …) so the autolink path is the
  only one third parties see.

### Phase 3: migrate one in-tree module

Start with **AsyncStorage** — small surface area, no GTK widgets, no
ShadowNode lifecycle. Rewrite as `vnext/src/storage/AsyncStorageModule.{h,cpp}`
subclassing the codegen-generated `NativeAsyncStorageCxxSpec`.
Delete the corresponding `rnLinux.storage*` JSI bindings; userland
import (`@react-native-async-storage/async-storage`) keeps working
because the JS shim already calls `TurboModuleRegistry.get('RNCAsyncStorage')`
internally. Verifies the codegen + manager + JS-side surface end-to-end.

### Phase 4: migrate remaining modules + add three new ones

- Move DeviceInfo, Location, Camera, Notifications, SecureStore,
  Network, Battery, Sharing, Clipboard, Localization, Haptics,
  KeepAwake, FileSystem, Print, Pickers, ScreenCapture, Image
  off the `rnLinux.*` surface and onto the codegen pipeline.
  Each is one commit.
- Then prove the autolink path with three new third-party modules:
  - `@react-native-community/netinfo` — GNetworkMonitor backend
  - `react-native-mmkv` — POSIX `mmap` on `$XDG_DATA_HOME/<app>/mmkv/`
  - `sentry-react-native` — libcurl POST to the configured DSN
- Each lands as `feat(autolink): <package>` and is the canonical
  test that an unrelated repo can drop in a native RN library and
  have it work.

## Open questions

- **`Codegen.cmake` target**: today the codegen target stamps
  `Markers.h` but doesn't actually run the full generator. The
  upstream `@react-native/codegen/lib/cli/combine/index.js` is a node
  CLI — we'd need to invoke it from CMake (already done for
  `Markers.h`) and capture the generated specs into the build dir.
- **Platform value**: codegen distinguishes platforms via the
  `--platform` flag (`ios`, `android`, plus `cxx` for cross-platform
  C++). `cxx` is the natural fit — none of our specs need
  platform-specific output. Verify that the upstream `cxx` flavor
  handles every shape (modules + components + commands) we need.
- **C++20 fold expressions** in generated code work fine on GCC 13;
  no special handling needed.
- **CodegenConfig.modulesProvider**: RN's own codegen reads
  `codegenConfig.name` and `codegenConfig.type` from `package.json`.
  Pick a name (`RNLinuxRncoreSpec`?) and stamp it consistently across
  the in-tree modules.

## Out of scope

- **Static linking of the autolinked modules**: today's autolinked
  modules become a shared library that the app dlopens at runtime.
  Static linking with whole-archive flags is a packaging concern; the
  TurboModule plumbing is orthogonal.
- **TurboModule iOS/Android Java/Kotlin bridging**: those are
  upstream RN problems and don't affect Linux. Our codegen output is
  pure C++.

## Effort estimate

- Phase 1 (codegen target): 3-5 days. Most of the work is figuring
  out the right flags + integrating into the existing CMake codegen
  target.
- Phase 2 (manager + registration): 2 days. The registry already
  exists; this is plumbing.
- Phase 3 (AsyncStorage migration): 1 day. Small surface.
- Phase 4 (~17 in-tree modules + 3 new third-party): 2-3 weeks. The
  per-module migrations are all similar but each one needs to round-
  trip through the test harness.

Total: ~4-6 weeks of focused work. The single biggest unblock for the
project — once this lands, the next 50 npm packages with native code
work by `pnpm add`-ing them.
