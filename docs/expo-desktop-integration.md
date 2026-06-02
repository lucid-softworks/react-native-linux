# Integrating with `shirakaba/expo-desktop`

`expo-desktop` is userland Expo glue for out-of-tree React Native platforms.
It ships a config plugin, a CLI, a port of `expo-modules-core`, and a JSI
stubs package. Today it wires Expo into `react-native-macos` and
`react-native-windows`; this doc covers what's needed to land Linux as a
sibling.

This is a contract doc, not a step-by-step. It describes the surface
`react-native-linux` exposes for slot-in consumers and what
`expo-desktop` would need to add on its side.

---

## What rn-linux already exposes

### Platform registration

`template/react-native.config.js` registers `linux` with
`@react-native-community/cli`:

```js
module.exports = {
  platforms: {linux: {}},
  project: {linux: {sourceDir: 'linux'}},
};
```

With `@lucid-softworks/react-native-linux-cli` installed, the CLI
recognises `react-native run-linux`, `react-native bundle-linux`,
`react-native init-linux`, `react-native autolink-linux`,
`react-native pack-linux`, and `react-native log-linux` — the same
verb shape rnc-cli already uses for `run-macos` / `run-windows`.

### TurboModule codegen

`@lucid-softworks/react-native-linux-codegen` consumes
`@react-native/codegen`'s `TypeScriptParser` output and emits one
self-contained C++ header per NativeModule spec. Each header declares
an abstract `<SpecName>Spec` extending `rnlinux::TurboModule` with
one pure virtual per method, and inline overrides of
`jsi::HostObject::get` / `getPropertyNames` that dispatch each spec
method through `createFromHostFunction`. Implementers subclass and
override one virtual per method — no JSI plumbing in user code.

Type coverage today:

| Spec type                     | C++                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `string`                      | `std::string`                                                                                                                                                |
| `number` / `double` / `float` | `double`                                                                                                                                                     |
| `Int32`                       | `int32_t`                                                                                                                                                    |
| `boolean`                     | `bool`                                                                                                                                                       |
| `void` (return)               | `void`                                                                                                                                                       |
| Object                        | generated `struct` with named fields + `toDynamic()` + `static fromDynamic()` (recursive); named type aliases deduped from `schema.aliasMap`                 |
| Array / generic object        | `folly::dynamic`                                                                                                                                             |
| Nullable\<T>                  | inner C++ (MVP)                                                                                                                                              |
| Enum\<string \| number>       | underlying primitive                                                                                                                                         |
| `Promise<T>`                  | trailing `std::function<void(T)> resolve` + `std::function<void(folly::dynamic)> reject`, posted via `RuntimeExecutor` so resolve/reject are safe off-thread |
| `Function (...args) => void`  | `std::function<void(args...)>`, posted via `RuntimeExecutor`                                                                                                 |

Implementer-facing shape: instead of building `folly::dynamic::object(...)`
chains, methods that return an object construct a brace-initialised struct
and the generator handles the conversion. Each generated struct ships
both a `toDynamic` helper and a `static fromDynamic` factory, so object
params arrive pre-populated. Module registration is a one-liner:

```cpp
[[maybe_unused]] static const int kRegister =
    codegen::NativeFooSpec::install<FooImpl>();
```

Nested anonymous objects get their own struct named `<Parent>_<Field>`
(post-order declaration). See `PlatformConstants.cpp` and
`CodegenSmoke.cpp` for worked examples — the smoke file is also a
compile-time guard that exercises every non-trivial generator path
(Promise, callback, object in/out).

Wiring lives in two places:

- **In-tree specs**: `scripts/codegen/run.js` walks
  `packages/@lucid-softworks/react-native-linux/Libraries/` for
  `Native*.ts` / `*NativeComponent.ts` and emits headers under
  `${CMAKE_BINARY_DIR}/codegen/specs/`. CMake's `react_native_linux`
  target depends on the resulting stamp.

- **Third-party specs**: `react-native autolink-linux` walks
  `ctx.dependencies` for the standard RN `codegenConfig` key. For
  each dep with `type === 'modules'` (or no `type`), it locates spec
  files under `jsSrcsDir`, codegens them into
  `linux/build/codegen/<sanitised-dep-name>/specs/`, and the emitted
  `autolinked.cmake` adds the dir to the dep's `cmakeTarget` via
  `target_include_directories`. This is the path
  `expo-desktop-modules-core` would slot in through.

The first real consumer in-tree is `PlatformConstants` — the C++ impl
extends the generated `NativePlatformConstantsLinuxSpec` and overrides
a single `getConstants()` virtual.

Verified against the upstream `expo-desktop-modules-core` spec files
(`NativeExpoMainRuntimeInstaller.ts`, `NativeNativeUnimoduleProxy.ts`):
both lower to valid C++ headers with the `install<Impl>()` registration
helper. Consumer-side hookup is a static-init slot per module:

```cpp
[[maybe_unused]] static const int kRegisterInstaller =
    codegen::NativeExpoMainRuntimeInstallerSpec::install<MainRuntimeInstaller>();
[[maybe_unused]] static const int kRegisterProxy =
    codegen::NativeNativeUnimoduleProxySpec::install<UnimoduleProxy>();
```

### Pre-bundle JSI hooks: `addRuntimeInitializer`

`expo-desktop-stubs` installs `globalThis.expo` via C++ JSI before
the bundle evaluates. `expo-desktop-modules-core` (once wired —
see Gaps below) adds TurboModule factories the same way.

`rnlinux::RNLinuxHost::addRuntimeInitializer` is the registration
point. Stack as many as you need; they fire in registration order on
the JS thread, with per-callback exception isolation:

```cpp
#include <react-native-linux/RNLinuxHost.h>

host.addRuntimeInitializer([](facebook::jsi::Runtime& rt) {
  // Install globalThis.expo for expo-modules-core's resolver.
  auto expo = facebook::jsi::Object(rt);
  rt.global().setProperty(rt, "expo", std::move(expo));
});

host.addRuntimeInitializer([](facebook::jsi::Runtime& rt) {
  // Register a TurboModule factory.
  rnlinux::TurboModuleRegistry::instance().registerModule(
      "ExpoDesktopModulesCore", makeModulesCoreFactory());
});
```

The internal rnLinux bridge is itself one of these initialisers
(`RNLinuxApplication.cpp`), so consumer registrations never collide
with the built-ins.

### Metro shim composition: `withLinuxExpoShims`

The shim table for Linux-incompatible Expo modules lives in
`@lucid-softworks/react-native-linux-expo/metro`. The wrapper is
additive — it preserves any upstream `resolveRequest`, leaves every
other resolver/transformer field intact, and only intervenes when
`platform === 'linux'`:

```js
// Inside a consumer's metro.config.js
const {getDefaultConfig} = require('@expo/metro-config');
const {withMetroConfig} = require('@rnx-kit/metro-config');
const {withLinuxExpoShims} = require('@lucid-softworks/react-native-linux-expo/metro');

const expoCfg = getDefaultConfig(__dirname);
const rnxCfg = withMetroConfig(expoCfg, {
  /* ... */
});

module.exports = withLinuxExpoShims(rnxCfg);
```

For non-Expo (template) projects:

```js
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {withLinuxExpoShims} = require('@lucid-softworks/react-native-linux-expo/metro');

module.exports = withLinuxExpoShims(
  mergeConfig(getDefaultConfig(__dirname), {
    resolver: {platforms: ['linux', 'ios', 'android', 'native']},
  }),
);
```

The helper also exports `linuxExpoShims` (the raw table) and
`createLinuxResolver(next)` for consumers that want to assemble their
own `resolveRequest`.

### Runtime + version surface

| Dimension      | rn-linux pin                                     | expo-desktop catalog band          |
| -------------- | ------------------------------------------------ | ---------------------------------- |
| `react-native` | `^0.85.3`                                        | `0.81 / 0.82 / 0.83 / 0.84 / 0.85` |
| `react`        | `19.2.3`                                         | `19.1 / 19.2`                      |
| JS engine      | Hermes 0.12                                      | Hermes (platform binaries)         |
| `expo` peer    | `@expo/config` >=12, `@expo/config-plugins` >=54 | same                               |

rn-linux sits at the top of expo-desktop's supported band on both
RN and React. Hermes is shared. No version-level blocker.

### Hermes globals

Hermes 0.12 ships without several Web APIs Expo packages assume
(`AbortController`, `FormData`, `Blob`, `Headers`, etc.). rn-linux
polyfills these in its bundle entry shims; consumers don't need to
patch anything for those specifically.

---

## What expo-desktop would need to add

The cleanest framing: Linux as a sibling platform alongside macOS
and Windows in the existing plugin / CLI surface.

### Config plugin

Add a `plugins/linux/` sibling to the existing `android`, `ios`,
`macos`, `windows` mod directories in
`expo-desktop-config-plugins`. The Linux mod compiler would write
into the project's `linux/` directory — which already exists for
rn-linux template projects and is owned by
`react-native.config.js`'s `project.linux.sourceDir`.

### Workspace catalog entry

Add a `react-native-linux` row to `pnpm-workspace.yaml` catalogs
pointing at `@lucid-softworks/react-native-linux`. Pair it with
matching React / RN versions per the table above.

### app.json + plugin invocation

Consumers would extend `app.json` with a `linux` block and add
`linux` to the `platforms` list. A minimal example:

```json
{
  "expo": {
    "platforms": ["android", "ios", "macos", "windows", "linux"],
    "linux": {
      "applicationId": "works.lucidsoft.demo",
      "displayName": "Demo"
    },
    "plugins": [
      [
        "expo-desktop-config-plugins",
        {
          "displayName": "Demo",
          "bundleIdentifier": "works.lucidsoft.demo"
        }
      ]
    ]
  }
}
```

`applicationId` becomes the GApplication reverse-DNS id and the
`.desktop` file `Name=` line; `displayName` becomes the GtkWindow
title. rn-linux's `init-linux` template substitutes these from
`package.json` today — the plugin would write them directly from
`app.json` instead.

### Run verb

The demo runs through `rnc-cli run-macos` / `run-windows` today.
Linux parity: `react-native run-linux` works out of the box once
`@lucid-softworks/react-native-linux-cli` is a dep, no extra wiring
needed.

---

## Gaps

### TurboModule codegen follow-ups

The TurboModule codegen covers everything `@react-native/codegen`'s
schema can express: primitives, void, typed C++ structs (with
`toDynamic` and `static fromDynamic`), `folly::dynamic` for arrays
and generic objects, nullables, enums, `Promise<T>` (off-thread
safe via `RuntimeExecutor`), `(...) => void` callbacks
(off-thread safe), object args inside callbacks, `(...) => R`
callbacks with primitive R (synchronous, on JS thread), and
type-alias dedup driven by `schema.aliasMap`. Verified end-to-end
against `expo-desktop-modules-core`'s real specs.

There are no longer load-bearing TM-side codegen gaps. Lone edge
that still throws: typed-object / `Promise<T>` returns from a
non-void sync callback — primitive returns work end-to-end, and
no real spec in the wild combines a typed-object return with the
sync-callback shape.

**Fabric component coverage.** The component generator handles
every prop shape the upstream codegen schema emits: primitives,
`ColorPrimitive`/`PointPrimitive`/`EdgeInsetsPrimitive`/
`DimensionPrimitive`/`ImageSourcePrimitive` reserved types,
String + Int32 enums (typed `enum class` + ADL `fromRawValue`),
Object props (generated `<Comp><Prop>` struct + `toDynamic`/
`fromDynamic`/`fromRawValue`), and `Array<T>` props
(`std::vector<T>` with item-struct generation when T is an
object). Events lower to typed `<Name><Event>` structs + emitter
methods; `codegenNativeCommands` produces a `<Name>HandleCommand`
dispatcher wired through `LinuxComponentView::handleCommand` →
`LinuxSchedulerDelegate::schedulerDidDispatchCommand`.
Components auto-register via
`codegen::installComponent()` (parallel to TM's
`Spec::install<Impl>()`) — no manual registry bootstrap
required for third-party autolinked components.

Nothing in the standard component spec surface blocks
`expo-desktop-modules-core` or downstream view-shipping Expo
packages today.

**JS-side fallback** for anything the codegen can't yet express:
`@lucid-softworks/react-native-linux-expo/expo-modules-core.js`
implements `requireNativeModule`, `EventEmitter`, `SharedRef`,
`CodedError` against a JS-side `globalThis.expo.modules` registry.
Consumers can register modules from JS via
`registerExpoModule(name, impl)` and skip the C++ codegen path
entirely for any specific module.

### Expo CLI `linux` platform tolerance

Verified against `@expo/config@56.0.9` (SDK 56): `getConfig()` accepts
`platforms: ["ios", "android", "linux", "macos", "windows"]` and a
sibling `linux: {...}` block in `app.json` — both round-trip without
schema or validator errors, no patcher needed.

Caveat: `@expo/config-types`'s `ExpoConfig.platforms` is typed as
`('android' | 'ios' | 'web')[]`, so a TypeScript `app.config.ts`
spelling `"linux"` would fail typecheck. Workarounds, in order of
preference:

1. Stay on `app.json` (JSON skips the union check).
2. Cast through `as any` at the platforms array.
3. Upstream the type widening so `linux` (and ideally `macos` /
   `windows`) join the union — same change `expo-desktop` would
   benefit from.

### Expo prebuild

`expo-desktop` documents `npx expo prebuild` as iOS/Android-only and
ships a separate `npx expo-desktop prebuild` that is "not yet
implemented" per its README. rn-linux's `init-linux` is the
equivalent today. Whichever side ends up owning Linux prebuild can
share scaffolding with `init-linux`.

---

## Validation checklist

A successful slot-in is:

- [ ] `npx expo-desktop create-app` (or a similar scaffold path)
      produces a project with `linux/` populated by rn-linux's template.
- [ ] `react-native run-linux` from inside that project launches a
      working GtkApplicationWindow with the bundle Metro served.
- [ ] `globalThis.expo` exists before user code runs — verifiable
      by adding `console.log(globalThis.expo)` to the entry and seeing
      it print an object, not `undefined`.
- [ ] An Expo module that the shim layer covers (e.g.
      `expo-router`, `expo-status-bar`) imports and renders.
- [ ] An Expo module NOT in the shim layer fails with a clear
      resolver error pointing at the missing shim, not a Hermes-level
      crash.
