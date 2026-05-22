# react-native-linux — MVP Roadmap

Decisions locked in (2026-05-21):
- **UI toolkit:** GTK4 (via `gtk4` + optionally `libadwaita-1` later)
- **JS engine:** Hermes
- **Architecture:** Fabric-ready from day one (new renderer + TurboModules)
- **Repo layout:** Monorepo, mirroring `microsoft/react-native-windows` (`vnext/` + `packages/*`)
- **Target RN version:** pin to a specific recent release (decide: 0.76 vs 0.77 — see Phase 0)

> "MVP working" = `npx ... init` produces a Linux app that, when built and run, opens a
> GTK4 window showing a JS-rendered `<View><Text>Hello from React Native on Linux</Text></View>`,
> with Metro reload, via Fabric mounting onto real GTK widgets.

---

## Phase 0 — Decisions to lock before writing code

- [x] Pin react-native peer dep version: `^0.76` (set in both package.jsons; Hermes verification still pending first end-to-end VM build).
- [x] Pick package manager: **pnpm 9** (chosen 2026-05-22 over yarn 3; faster + simpler workspace model).
- [x] npm scope: `@lucid-softworks/*` (chosen 2026-05-22). All packages live under that scope: `@lucid-softworks/react-native-linux`, `@lucid-softworks/react-native-linux-cli`.
- [x] License: MIT (chosen 2026-05-22). `LICENSE` is present; copyright-header policy: not required (use SPDX `// SPDX-License-Identifier: MIT` only if a contributor opts in).
- [x] Author/org metadata for `package.json` files (`author`, `repository`, `bugs`, `homepage` on root + both published packages).
- [x] CI provider: GitHub Actions, Linux-only runners are sufficient (`.github/workflows/ci.yml`).
- [x] Distro support matrix: Ubuntu 22.04 LTS + 24.04 LTS (CI matrix). Stretch: Fedora 40, Arch (post-MVP).
- [x] Hermes acquisition strategy: **Option A** (build from source via CMake `FetchContent`, pinned to the RN-vendored tag). Implemented in `vnext/cmake/FetchHermes.cmake`. Option B (prebuilt vendor) deferred.
- [x] Codegen strategy: use stock `@react-native/codegen` and emit linux-platform specs (no fork). Documented in `docs/native-modules.md`.

## Phase 1 — Repo + tooling foundation

- [x] Root `package.json` declares JS-only packages via `pnpm-workspace.yaml` (`packages/@lucid-softworks/*`, `template`, `apps/*`). vnext is C++, not a workspace.
- [x] `.editorconfig`, `.prettierrc`, `.eslintrc.js` (extend `@react-native`).
- [x] `clang-format` config for C++ (LLVM-derived, RN style).
- [x] `tsconfig.base.json` consumed by each TS package.
- [x] `LICENSE` (MIT).
- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- [x] `CODEOWNERS`.
- [x] Pre-commit: husky + lint-staged running eslint + prettier + clang-format on staged files.
- [x] Commit-message convention (Conventional Commits, documented in `CONTRIBUTING.md`). Replacing `changesets` with `release-please` (already configured in `release-please-config.json`).
- [x] Dependabot config (`.github/dependabot.yml`) — weekly npm + GitHub Actions, grouped (eslint, typescript, jest, react-native).
- [x] Top-level `README.md` with quick-start + repo layout (architecture diagram lives in `docs/architecture.md`).
- [x] `docs/` directory:
  - [x] `docs/architecture.md`
  - [x] `docs/getting-started.md`
  - [x] `docs/native-modules.md`
  - [x] `docs/component-support.md` (matrix)
  - [x] `docs/troubleshooting.md`
  - [x] `docs/dev-vm.md` (bonus: Lima VM workflow for macOS contributors)

## Phase 2 — JS package (`packages/@lucid-softworks/react-native-linux`)

- [x] `package.json`:
  - [x] `peerDependencies`: `react`, `react-native`
  - [x] `main: index.js`
  - [x] `react-native.config.js` for autolinking + platform registration
- [x] `index.js` re-exports RN core + Linux-specific extensions.
- [x] `Libraries/Utilities/Platform.linux.js` setting `Platform.OS = 'linux'`.
- [x] `Libraries/Components/View/View.linux.js` (native host component, codegen).
- [x] `Libraries/Components/Text/Text.linux.js`.
- [x] `Libraries/Components/UnimplementedViews/UnimplementedNativeView.linux.js`.
- [ ] `Libraries/AppRegistry/AppRegistry.linux.js` shim — decided: rely on stock for now.
- [x] Codegen specs (`*NativeComponent.{ts,js}`) for View, Text.
- [x] TypeScript types (`index.d.ts`) re-exporting RN types with linux-only additions.
- [x] Jest setup (`jest.config.js`) + `jest-preset` so consumers can run tests.
- [x] Snapshot of supported APIs vs RN core (table in [docs/component-support.md](./docs/component-support.md)).

## Phase 3 — CLI package (`packages/@lucid-softworks/cli`)

- [x] `package.json` depending on `@react-native-community/cli-types`.
- [x] `src/index.ts` exporting `commands`, `platforms` for RN CLI config.
- [x] Commands:
  - [x] `run-linux` — cmake configure + build + launch executable.
    - [x] `--release` flag
    - [x] `--no-packager` flag
    - [x] `--build-dir` flag
  - [x] `bundle-linux` — wraps Metro with `platform=linux`.
  - [x] `init-linux` — bootstraps a Linux project inside an existing RN app (idempotent).
  - [x] `log-linux` — tail journalctl / app's stderr log file.
  - [x] `autolink-linux` — generate CMake includes for linked native deps.
- [x] Platform registration object (`platforms.linux`).
- [x] Dependency-config schema for third-party native modules:
  - [x] CMake target name
  - [x] Sourceset path
  - [ ] Include dirs (deferred; not currently propagated through the generated `autolinked.cmake`).
- [x] Tests (jest + ts-jest).
- [ ] Help text / `--help` output for each command (covered by RN CLI; each command's `description` + `options[].description` populate `--help` automatically — verify once first end-to-end run lands).

## Phase 4 — Template (`template/`)

- [x] `template/App.tsx` — minimal `<View><Text>Hello</Text></View>`.
- [x] `template/index.js` — `AppRegistry.registerComponent('App', () => App)`.
- [x] `template/package.json` with deps on `react`, `react-native`, `@lucid-softworks/react-native-linux`.
- [x] `template/tsconfig.json`.
- [x] `template/metro.config.js` (linux platform extension).
- [x] `template/linux/CMakeLists.txt` — calls into vnext, builds an executable, includes `autolinked.cmake`.
- [x] `template/linux/main.cpp` — boots `RNLinuxHost`, loads `index.linux.bundle`.
- [x] `template/linux/CMakePresets.json` (debug + release).
- [x] `template/linux/app.desktop` (.desktop entry).
- [ ] `template/linux/icons/` (PNG 16/32/64/128/256 + scalable SVG) — binary assets, deferred until visual identity exists.
- [x] `template/.gitignore`.

## Phase 5 — Native runtime (`vnext/`) — the hard part

### 5.1 — Build system

- [x] `vnext/CMakeLists.txt` top-level (`cmake_minimum_required 3.25`, project, C++20).
- [x] `vnext/CMakePresets.json` (debug-x86_64, release-x86_64, debug-aarch64).
- [x] `vnext/cmake/` helper modules:
  - [x] `FindGTK4.cmake` (prefer pkg-config)
  - [x] `FetchHermes.cmake`
  - [x] `FetchFolly.cmake`, `FetchGlog.cmake`, `FetchFmt.cmake`, `FetchDoubleConversion.cmake`, `FetchBoost.cmake` (Boost: header-only subset for RN's needs)
  - [x] `ReactNativeHeaders.cmake` — locate `node_modules/react-native/ReactCommon/**`
- [x] Install rules (in `vnext/CMakeLists.txt`) + `react-native-linux.pc` pkg-config file emitted via `configure_file` from `cmake/react-native-linux.pc.in` and installed under `${libdir}/pkgconfig/`.
- [ ] Verify clean build on Ubuntu 22.04 + 24.04 (CI matrix configures both; full `cmake --build` not yet expected to succeed end-to-end — Fabric headers still stubbed).

### 5.2 — Host / instance plumbing

- [ ] `vnext/include/react-native-linux/RNLinuxHost.h`
  - [ ] Constructor takes bundle URL + assets path.
  - [ ] `start()`, `stop()`, `reload()`.
  - [ ] `attachSurface(SurfaceHandler&)`.
- [ ] `vnext/src/RNLinuxHost.cpp`
  - [ ] Owns `ReactInstance` (`react/runtime/ReactInstance.h`).
  - [ ] Owns Hermes runtime via `hermes::makeHermesRuntime`.
  - [ ] Owns `JSExecutorFactory` wrapping Hermes.
  - [ ] Owns `Scheduler` for Fabric.
  - [ ] Owns `RuntimeExecutor`.
  - [ ] Bundle loader (file:// + http:// for Metro dev server).
- [ ] `vnext/src/jsi/HermesRuntimeFactory.cpp` — adapter.
- [ ] Threading model:
  - [ ] JS thread: dedicated `std::thread` with folly executor.
  - [ ] UI thread: GTK4 `GMainContext` (the main loop owns it).
  - [ ] Cross-thread dispatch: `g_idle_add` for JS→UI, `JSExecutor::invokeAsync` for UI→JS.

### 5.3 — Fabric integration

- [ ] `LinuxComponentDescriptorRegistry` registering core descriptors:
  - [ ] `ViewComponentDescriptor` (reused from `react/renderer/components/view`)
  - [ ] `ParagraphComponentDescriptor` (text)
  - [ ] `RawTextComponentDescriptor`
  - [ ] `TextComponentDescriptor`
  - [ ] (later) `ScrollViewComponentDescriptor`
  - [ ] (later) `ImageComponentDescriptor`
- [ ] `LinuxSchedulerDelegate` (implements `SchedulerDelegate`):
  - [ ] `schedulerDidFinishTransaction` → forward to mounting manager.
  - [ ] `schedulerDidRequestPreliminaryViewAllocation`.
  - [ ] `schedulerDidDispatchCommand`.
- [ ] `SurfaceHandler` lifecycle (start/stop, layout constraints).
- [ ] `LayoutContext` (point scale factor from `gdk_monitor_get_scale_factor`).

### 5.4 — Mounting layer (GTK4)

- [ ] `LinuxMountingManager`:
  - [ ] Subscribes to `MountingCoordinator`.
  - [ ] On UI thread, pulls `MountingTransaction`, executes mutations.
- [ ] `LinuxComponentViewRegistry`: `Tag → ComponentView*`.
- [ ] `LinuxComponentView` base class:
  - [ ] Wraps a `GtkWidget*`.
  - [ ] `updateProps(oldProps, newProps)`.
  - [ ] `updateLayoutMetrics(metrics)` → `gtk_fixed_move` + `gtk_widget_set_size_request`.
  - [ ] `updateEventEmitter`.
  - [ ] `updateState`.
  - [ ] `mountChildComponentView` / `unmountChildComponentView`.
- [ ] Concrete views:
  - [ ] `ViewComponentView` → `GtkFixed` (children get absolute frames).
    - [ ] Background color via CSS provider per widget.
    - [ ] Border radius via CSS.
    - [ ] Opacity via `gtk_widget_set_opacity`.
    - [ ] Transform: matrix → GTK4 has no first-class matrix on widgets; use `GtkSnapshot` + custom widget subclass or fall back to CSS for translate/rotate.
  - [ ] `ParagraphComponentView` → `GtkLabel`.
    - [ ] Text content from attributed string fragments.
    - [ ] Font family/size/weight/color via PangoAttrList.
    - [ ] Multi-line + wrap mode.
- [ ] Root view: a `GtkFixed` inside a `GtkApplicationWindow`.
- [ ] CSS provider lifecycle (one global `GtkCssProvider`, per-widget classes for unique styles).

### 5.5 — Event pipeline

- [ ] `GestureRecognizer` equivalents using `GtkGestureClick`, `GtkGestureLongPress`, `GtkEventControllerMotion`, `GtkEventControllerScroll`.
- [ ] Hit testing: rely on GTK propagation (children-first) — verify it matches RN semantics.
- [ ] Event dispatch:
  - [ ] Pointer events: `onPressIn`, `onPressOut`, `onPress`, `onLongPress`.
  - [ ] Touch events: synthesize from pointer if needed (Linux mostly mouse/trackpad).
  - [ ] Keyboard events: `onKeyDown` / `onKeyUp` for `<TextInput>` later.
- [ ] `EventEmitter::dispatch` from UI thread → JS thread via runtime executor.

### 5.6 — TurboModule infrastructure

- [ ] `TurboModuleManager` setup on the runtime.
- [ ] CxxModule registration hook for autolinking.
- [ ] One sample TurboModule shipped in core (e.g. `PlatformConstants` returning OS info from `uname` + `/etc/os-release`).
- [ ] Codegen integration:
  - [ ] Run `@react-native/codegen` against `linux` platform.
  - [ ] Emit C++ spec headers under `vnext/codegen/`.
  - [ ] CMake target for codegen step.

### 5.7 — Logging + diagnostics

- [ ] `LinuxLogger` wired into `LogBox` JS-side via `RCTLog` equivalent.
- [ ] stderr backend by default; opt-in journald via `libsystemd` (link conditionally).
- [ ] Crash handler (`std::set_terminate` + backtrace via `libunwind` or `<execinfo.h>`).

### 5.8 — DevTools / DX

- [ ] Metro WebSocket client for live reload.
- [ ] Hermes inspector: open port 8081-debug, document Chrome DevTools URL.
- [ ] `Cmd+R` / `Ctrl+R` keybinding triggers reload (intercept at GTK level).
- [ ] LogBox / RedBox UI: render with GTK4 (`GtkWindow` + `GtkTextView`) — punt to phase 6 if needed.
- [ ] Performance overlay (FPS) — punt.

## Phase 6 — Sample app (`apps/playground/`)

- [ ] Built from the template + a richer screen tree.
- [ ] Showcases: View nesting, Text styles, basic layout (flexbox via Yoga, already in RN).
- [ ] Used as the integration target for CI smoke tests.

## Phase 7 — Testing

### 7.1 — JS-side

- [x] Jest config; mirror RN's `jest-preset` (`packages/@lucid-softworks/react-native-linux/jest.config.js`).
- [ ] Snapshot tests for codegen output (needs the codegen CMake step from §5.6 first).
- [x] Unit tests for CLI commands (`platformConfig`, `autolinkLinux`).

### 7.2 — Native-side

- [ ] GoogleTest under `vnext/tests/`.
- [ ] CMake `add_test` integration with `ctest`.
- [ ] Coverage: lcov + report on CI.

### 7.3 — Integration / e2e

- [ ] `xvfb-run` harness for headless GTK4.
- [ ] Take screenshot via `gdk_window_get_pixbuf` or `grim` (Wayland) and diff against golden.
- [ ] Smoke test: boot playground, assert window opens + text visible.

### 7.4 — CI

- [x] GitHub Actions workflow `.github/workflows/ci.yml`:
  - [x] Matrix: ubuntu-22.04, ubuntu-24.04 (`configure-vnext` job).
  - [x] Install GTK4 + Hermes build deps
  - [ ] Configure + build + test — configure-only for now (full build blocked on Fabric headers).
  - [x] Cache `vnext/build/_deps` and Hermes build output
- [x] Lint workflow: `lint-js` (eslint + prettier + jest), `lint-cpp` (clang-format --dry-run --Werror). clang-tidy still pending — needs a successful build first.
- [x] Codegen drift check via `react-native autolink-linux --check` in the `autolink-drift` job. Currently non-fatal; flips to a hard gate once Phase 6 introduces native deps.

## Phase 8 — Distribution

- [ ] `npm publish` workflow on tag push.
- [ ] Versioning policy (track RN minor versions? Independent?). Document.
- [ ] AppImage packaging (linuxdeploy + appimagetool) — script in `scripts/`.
- [ ] Flatpak manifest (`org.reactnative.Linux.Sample.yaml`) — stretch.
- [ ] Debian package (.deb) — stretch.
- [ ] Snap (snapcraft.yaml) — stretch.

## Phase 9 — Post-MVP component coverage

In rough priority order:

- [ ] `ScrollView` → `GtkScrolledWindow`
- [ ] `Image` → `GtkPicture` + libsoup3 for network fetches + gdk-pixbuf for decode
- [ ] `TextInput` → `GtkEntry` / `GtkTextView`
- [ ] `Pressable` (mostly JS; just needs hit testing)
- [ ] `Switch` → `GtkSwitch`
- [ ] `ActivityIndicator` → `GtkSpinner`
- [ ] `Modal` → second `GtkWindow` with `transient-for`
- [ ] `RefreshControl` → custom (no direct GTK4 equivalent)
- [ ] `FlatList` / `SectionList` (JS-only, but verify perf on top of ScrollView)
- [ ] `Animated` (mostly JS; ensure `useNativeDriver` path or document its absence)
- [ ] `Linking` → `g_app_info_launch_default_for_uri`
- [ ] `Clipboard` → `gdk_clipboard_set_text`
- [ ] `Dimensions` → `gdk_monitor_*`
- [ ] `Appearance` (light/dark) → `gtk-application-prefer-dark-theme` / `AdwStyleManager`
- [ ] `AccessibilityInfo` → AT-SPI2 via ATK bridge
- [ ] `StatusBar` (no-op on Linux desktop; document)
- [ ] `KeyboardAvoidingView` (no-op on desktop, mostly)
- [ ] `Alert` → `GtkAlertDialog` (GTK 4.10+)

## Phase 10 — Stretch / nice-to-haves

- [ ] libadwaita integration for native-feeling widgets.
- [ ] Wayland-specific polish: client-side decorations, IME via `GtkIMContext`.
- [ ] X11 fallback (mostly automatic via GTK, just verify).
- [ ] Multi-window via multiple `SurfaceHandler` instances.
- [ ] D-Bus TurboModule (notifications via `org.freedesktop.Notifications`, secrets via `org.freedesktop.secrets`).
- [ ] Native file dialogs (`GtkFileDialog`).
- [ ] System tray (libayatana-appindicator).
- [ ] Auto-update (consider electron-updater equivalents or custom).
- [ ] Hardware video decode for `<Video>` (gstreamer).
- [ ] WebView (`WebKitGTK`).
- [ ] Maps (Mapbox GL native).
- [ ] Reanimated 3 compatibility audit.
- [ ] Skia integration (drop GTK, render directly) — long-term alternative architecture.

## Open questions to revisit

- [ ] How do we handle `react-native` headers that assume Android/iOS? Patch or upstream?
- [ ] Does Hermes need any patches for glibc / musl?
- [ ] Should we ship Hermes prebuilt as an OCI image artifact in GH Releases?
- [ ] What's the story for native-modules that already exist for iOS/Android — do we provide a shim layer or require new linux ports?
- [ ] Threading: can we get away with a single-threaded `RuntimeExecutor` for MVP and add the JS thread later?
- [ ] Yoga: bundled with RN, but does its CMake export work cleanly when consumed externally?

## First-week order of operations (resume here in the morning)

1. Phase 0 decisions (1 hour).
2. Phase 1 repo scaffolding (2 hours).
3. Phase 2 JS package skeleton (2 hours).
4. Phase 4 template skeleton — get `npx react-native init` producing *something* (3 hours).
5. Phase 5.1 CMake + dep fetching — get Hermes building (half a day).
6. Phase 5.2 RNLinuxHost stub that loads + evaluates a bundle (no rendering) (half a day).
7. Phase 5.3 + 5.4 — first GTK window with a single hard-coded `GtkLabel` driven by Fabric (1–2 days).
8. Wire Metro reload (4 hours).
9. CI green on ubuntu-24.04 (4 hours).

End of week-1 success criterion: `cd template && pnpm install && pnpm react-native run-linux` opens a window saying "Hello from React Native on Linux".
