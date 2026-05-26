# react-native-linux

React Native for Linux desktop. Renders to **GTK4**, runs JS on **Hermes**,
uses the **new architecture (Fabric + TurboModules)** from day one. Inspired
by and structurally modeled after
[microsoft/react-native-windows](https://github.com/microsoft/react-native-windows).

> **Status:** alpha. Real third-party RN libraries are starting to render —
> `react-native-paper` mounts and the floating-label animation in
> `<TextInput mode="outlined">` works end-to-end. The runtime is not yet
> production-ready. See the **what works / what doesn't** tables below and
> [TODO.md](./TODO.md) for the live roadmap.

## What works today

| Surface                             | Status                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `<View>` (GtkFixed)                 | ✅ flex layout, padding, margin, backgroundColor, borderRadius, opacity                |
| `<Text>` / `<Paragraph>` (GtkLabel) | ✅ font / color / alignment / numberOfLines; Yoga padding pushed in as CSS             |
| `<Image>` (GtkPicture)              | ✅ http(s) / file:// / data: sources via libsoup3, resizeMode                          |
| `<ScrollView>` (GtkScrolledWindow)  | ✅ vertical + horizontal scroll, onScroll                                              |
| `<TextInput>` (GtkText)             | ✅ value, placeholder, onChangeText, onSubmitEditing, onKeyPress, onFocus/Blur         |
| `<Switch>` (GtkSwitch)              | ✅ value, onValueChange, disabled, tint colors                                         |
| `<ActivityIndicator>` (GtkSpinner)  | ✅ animating, size                                                                     |
| `<FlatList>` / `<SectionList>`      | ✅ via the upstream JS impl on top of ScrollView                                       |
| `<Pressable>` / `<Button>`          | ✅ onPress, function-children render prop                                              |
| `<Modal>`                           | ✅ overlay + backdrop                                                                  |
| `transform`                         | ✅ translate / scale / rotate / matrix / origin (CSS transforms on GtkFixed children)  |
| `onLayout`                          | ✅ dispatched from `LinuxComponentView::updateLayoutMetrics`                           |
| `Animated` (JS driver)              | ✅ timing / sequence / parallel / loop                                                 |
| `Animated` (native driver)          | ✅ translateX/Y/scale/scaleX/Y/opacity drive `gtk_fixed_set_child_transform` per frame |
| Fast Refresh                        | ✅ HMR socket auto-reloads the app bundle; React state preserved across refreshes      |
| `AsyncStorage`                      | ✅ shimmed with a JSON file under `XDG_CONFIG_HOME`                                    |
| `react-native-device-info`          | ✅ all Windows-supported methods return real values from `/sys`, `/proc`, `/etc`       |
| `react-native-paper` (V3)           | ✅ Card, TextInput.Outlined, Switch, Snackbar mount and interact                       |

## What doesn't yet

| Surface                            | Status                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `react-native-safe-area-context`   | ⚠ shim returns zero insets; `SafeAreaProvider` is a passthrough `<View>`                  |
| `expo-camera` / `expo-location`    | ❌ expo-modules-core has no Linux native registry; `requireNativeModule()` throws         |
| Nested `<Text>` inside `<Text>`    | ❌ inner element renders as a U+FFFC object-replacement char                              |
| `async () => {…}` arrow functions  | ❌ Hermes 0.12 silently no-ops the body; use `async function () {…}` declarations instead |
| Multi-instance / per-app isolation | ❌ single GtkApplication, single Hermes runtime                                           |
| Full vnext `cmake --build` in CI   | ❌ configure-only — a few Fabric headers are still stubbed                                |

## Goals

- Make `npx @react-native-community/cli init MyApp` work with
  `react-native-linux` added, then `pnpm react-native run-linux` open a GTK4
  window that renders `<View><Text>Hello</Text></View>`.
- Keep the JS authoring experience identical to React Native on
  iOS / Android / Windows. `Platform.OS === 'linux'`; everything else is RN.
- Stay Fabric-only — no legacy bridge, no legacy view managers.

## Repo layout

```
react-native-linux/
├── packages/@lucid-softworks/
│   ├── react-native-linux/          # JS-side npm package (Platform shim, components)
│   ├── react-native-linux-expo/     # Stubs for the expo packages most RN apps drag in
│   └── cli/                         # CLI plugin: run-linux, bundle-linux, init-linux
├── vnext/                           # Native C++ runtime (CMake)
│   ├── include/react-native-linux/  # Public headers
│   ├── src/                         # Implementation
│   │   ├── fabric/                  # Fabric mounting + component view registry
│   │   ├── views/                   # GTK widget bindings (View, Text, Image, …)
│   │   ├── jsi/                     # Hermes runtime + JSI bindings + bundle loader
│   │   ├── storage/                 # AsyncStorage backing (JSON file)
│   │   ├── deviceinfo/              # react-native-device-info native backing
│   │   ├── modules/                 # PlatformConstants + other TurboModule stubs
│   │   └── devtools/                # MetroReloadClient (HMR socket)
│   └── cmake/                       # Helper modules (FetchHermes, FindGTK4, …)
├── template/                        # `react-native init` template
│   ├── App.tsx
│   └── linux/                       # Linux project files copied into apps
├── apps/playground/                 # First-party playground app + smoke tests
│   ├── App.tsx                      # Demo gallery (FlatList, Modal, Animated, …)
│   ├── paper-demo.tsx               # Real-app harness: react-native-paper
│   ├── smoke-demo.tsx               # Probe + live UI for 5 next-batch libraries
│   ├── runtime/                     # React + reconciler + shims (vendor bundle)
│   └── linux/                       # CMake app glue (main.cpp, autolinked.cmake)
├── docs/                            # Architecture, getting-started, real-app gap lists
│   ├── architecture.md
│   ├── component-support.md
│   ├── dev-vm.md
│   ├── native-modules.md
│   ├── packaging.md
│   ├── realworld-paper.md           # gaps surfaced by react-native-paper
│   ├── realworld-expo-location.md   # GeoClue2-backed expo-location shim
│   ├── realworld-expo-camera.md     # GStreamer-backed expo-camera shim
│   ├── realworld-expo-notifications.md  # libnotify-backed expo-notifications shim
│   ├── realworld-expo-file-system.md    # POSIX-backed expo-file-system shim
│   └── …
├── scripts/vm/                      # Lima dev VM helpers (start.sh, sh.sh, …)
└── TODO.md                          # Live roadmap
```

## Locked-in decisions

| Concern         | Choice                               |
| --------------- | ------------------------------------ |
| UI toolkit      | GTK4                                 |
| JS engine       | Hermes (built from source via CMake) |
| Architecture    | Fabric + TurboModules only           |
| Layout          | Yoga (bundled with RN)               |
| Package manager | pnpm 9                               |
| Build system    | CMake (Ninja)                        |
| Minimum RN      | `^0.76`                              |
| Minimum distro  | Ubuntu 24.04 LTS (CI gates on this)  |
| License         | MIT                                  |

## Quick start (intended UX once the runtime builds)

```sh
# In an existing RN app
pnpm add -D @lucid-softworks/react-native-linux @lucid-softworks/react-native-linux-cli
pnpm react-native init-linux
pnpm react-native run-linux
```

Until that's reliable, run the in-tree playground (see [Developing](#developing) below).

## Build dependencies (Ubuntu 24.04)

```sh
sudo apt install \
  build-essential cmake ninja-build pkg-config \
  libgtk-4-dev libsoup-3.0-dev \
  python3 python3-pip \
  nodejs npm
corepack enable
corepack prepare pnpm@9.15.5 --activate
```

Hermes, Folly, Glog, fmt, double-conversion, and a Boost subset are fetched
and built by CMake — no system packages needed for those.

## Developing

A scripted Lima VM gives macOS contributors a CI-parity Linux environment
with a visible Xfce desktop over VNC. The full flow:

```sh
# One-time
scripts/vm/start.sh                          # boot the rn-linux Lima VM
open vnc://127.0.0.1:5901                    # password: rnlinux

# Every iteration
scripts/vm/sh.sh 'cmake --build apps/playground/linux/build'
node apps/playground/bundle.mjs              # rebuild the JS bundle
scripts/vm/sh.sh 'bash scripts/vm/run-playground.sh'
```

`scripts/vm/sh.sh` is a thin wrapper around `limactl shell --workdir
/workspaces/react-native-linux` so paths line up between macOS host and Linux
guest — without `--workdir`, `limactl` inherits the host cwd and the guest
spams `bash: cd: …: No such file or directory` before every command.

Switching demos:

```sh
# The default demo (FlatList / Modal / Animated / TextInput / …)
node apps/playground/bundle.mjs

# react-native-paper drop-in
RN_ENTRY=paper-demo.tsx node apps/playground/bundle.mjs

# Smoke test for next-batch libraries (async-storage, device-info, …)
RN_ENTRY=smoke-demo.tsx node apps/playground/bundle.mjs
```

See [docs/dev-vm.md](./docs/dev-vm.md) for VM internals and
[docs/getting-started.md](./docs/getting-started.md) for native-build details.

## Real-app status

Each library below has its own gap list — what currently works, what
breaks, and what's been fixed in the process.

- [docs/realworld-paper.md](./docs/realworld-paper.md) — `react-native-paper@^5`
- [docs/realworld-expo-location.md](./docs/realworld-expo-location.md) — `expo-location` via GeoClue2
- [docs/realworld-expo-camera.md](./docs/realworld-expo-camera.md) — `expo-camera` via GStreamer
- [docs/realworld-expo-notifications.md](./docs/realworld-expo-notifications.md) — `expo-notifications` via libnotify
- [docs/realworld-expo-file-system.md](./docs/realworld-expo-file-system.md) — `expo-file-system` via POSIX + libsoup

The `smoke-demo.tsx` harness in `apps/playground/` covers the next batch:
`@react-native-async-storage/async-storage`, `react-native-device-info`,
`react-native-safe-area-context`, `expo-camera`, `expo-location`.

## Contributing

See [TODO.md](./TODO.md) for the prioritized work list. Each phase calls out
its acceptance criteria. Open issues for design questions before sending large
PRs.

Conventional Commits are required — release-please watches `main` for
`feat:` / `fix:` and produces release PRs that publish to npm on merge.

## License

MIT. See [LICENSE](./LICENSE).
