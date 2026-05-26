# react-native-linux — MVP Roadmap

Decisions locked in (2026-05-21):

- **UI toolkit:** GTK4 (via `gtk4` + optionally `libadwaita-1` later)
- **JS engine:** Hermes (vendor bundle pre-compiled to `.hbc` for fast cold start)
- **Architecture:** Fabric (Scheduler + cloneNodeWithNewProps persistent mode)
- **Repo layout:** Monorepo, mirroring `microsoft/react-native-windows` (`vnext/` + `packages/*`)
- **Target RN version:** `^0.76`

> "MVP working" target hit (2026-05-25): standard `import {View, Text, …} from 'react-native'` JSX renders into a GTK4 window via Fabric, with state-preserving Fast Refresh in ≈135 ms edit→visible.

---

## Status snapshot (2026-05-25)

Working end-to-end, verified live in the playground:

- **Components:** View, ScrollView, Image (file:// + HTTP via libsoup3), Text (Pango-backed measurement), TextInput (GtkText + onChangeText), Pressable, Button, FlatList (header / footer / separators / numColumns), Modal (in-window overlay).
- **Styling:** `style={…}` / `style={[a, b]}` / `StyleSheet.create`. backgroundColor, color, fontSize, fontFamily, fontWeight, fontStyle, textAlign, borderRadius (per corner), borderWidth (per side), borderColor, opacity.
- **Layout:** Yoga flexbox — flex, flexDirection, flexWrap, gap, justifyContent, alignItems / Self / Content, padding, margin, position absolute.
- **Events:** onClick / onPress via GtkGestureClick → `dispatchFabricClick(tag)` registry; onChangeText via `dispatchFabricChangeText(tag, s)`.
- **State + effects:** useState, useEffect, setInterval, requestAnimationFrame (~60 fps `g_timeout_add`). Hermes microtask drain wired after evaluate and after surface.start.
- **Animated:** Animated.Value / timing / sequence / parallel / loop / interpolate / Easing; Animated.View / Text / Image / ScrollView. JS driver only.
- **Persistence:** AsyncStorage (XDG JSON file, atomic save). `@react-native-async-storage/async-storage` import works.
- **`react-native` module shim:** importable as `from 'react-native'` — Platform (`OS = 'linux'`), Dimensions, Appearance, useColorScheme, Linking (stub).
- **Dev loop:** Edit → Fast Refresh ≈135 ms. swc-driven react-refresh transform on user files; Hermes-bytecode vendor for ≈10 ms cold-start JS eval; HMR push over Unix socket (no filesystem hop); the file monitor stays as a fallback.

What's broken right now:

- **Reconciler refs**: passing `ref={r}` to a host instance (`<View ref={r}>`) crashes Fabric at `UIManager::startSurface`. The fix is wiring `commitAttachRef` / `commitDetachRef` properly in `fabricHostConfig.js`. Animated.View dodges this via a generated `nativeID` side channel (see below); other apps that ref host instances will break. **[fixed 2026-05-25 — actually a missing `console` shim + missing `forwardRef` + the `createNode` 5th-arg being `instanceHandle` not state]**
- **LogBox panel doesn't visibly clear on Reload / Dismiss** **[fixed 2026-05-26 — two stacked bugs]**: (1) Hermes was built Debug and `HadesGC::checkWellFormed()` ran on every YG collection, making a 400-node remount take seconds and starving GTK's idle dispatch (mounting transactions queued but never ran). Release build dropped GC pauses from 100s of ms to single digits. (2) After the boundary catches, `performReactRefresh` on the live fiber tree hits a stale family and remounts in `Object.freeze` / `Set.prototype.forEach` for tens of seconds. Boundary's `componentDidCatch` now sets `__rnLinuxRecoveredFromError`; `fabric.js`'s `tryMount` checks the flag on the next bundle re-eval and falls back to a clean `reconciler.updateContainer` remount instead. Per-screen ErrorBoundaries in the `expo-router` shim mean a tab crash only unmounts the screen subtree (pathname useState survives, Dismiss recovers on the same tab).
- **Steady-state FPS on the Lima VM** is paint-bound at ~30 FPS with Animated.loop active, ~50 FPS idle. The full investigation lives in the perf section below — short answer: software cairo + TigerVNC/TurboVNC encode is the floor, hardware GPU is the only real fix.

Perf optimizations that landed (2026-05-25 perf push):

- Hermes register pool 128 KiB → 2 MiB — long-running Animated.loop chains were exhausting the pool, killing the rAF chain and producing 30→60 FPS swings.
- TurboVNC swapped in for TigerVNC (`/opt/TurboVNC/bin/vncserver`, systemd service `rn-linux-vnc.service`).
- `ViewComponentView` caches the last CSS string + opacity; `gtk_css_provider_load_from_string` only fires on change. Big win — was the bottleneck for Animated opacity updates.
- `LinuxComponentView::updateLayoutMetrics` diff-skips `gtk_widget_set_size_request` and `gtk_fixed_move` when nothing actually changed. Was the cause of a 19→4 FPS degradation over time (cumulative measure-invalidation cascade).
- Resize → Yoga commit coalesced behind a 33 ms `g_timeout` in `RNLinuxApplication.cpp`.
- Native Animated driver plumbed: `rnLinux.setNativeProp(nativeID, prop, value)` for `opacity` / `transform.translateX` / `transform.translateY`. Uses `gtk_fixed_set_child_transform` (paint-only, no layout cascade) for translates. Currently NOT used by default — on this VM software paint dominates and React's implicit batching beats the per-listener fire of native. Will be a clear win on bare-metal GTK.
- FlatList virtualization (JS-side via onScroll). `dispatchFabricScroll` → `fabricOnScroll` JSI binding wires the GtkAdjustment value-changed signal up to JS; the FlatList shim windows items at ~14 visible + buffer with absolute-positioned spacers preserving the scroll extent.
- `MountingManager.prof` + `rnLinux.rafProf` instrumentation rolls up per-mount and per-rAF timings every 60 transactions.

Honest gaps for arbitrary RN apps to drop in:

- Inline nested `<Text>` for mixed-style runs (Fabric collapses our intermediate Text shadow nodes; one Paragraph per outer `<Text>` today).
- `tintColor` on Image (needs a custom GdkPaintable subclass).
- `numberOfLines` / `ellipsizeMode` plumbed from Paragraph props (TextLayoutManager already accepts them).
- `Animated.useNativeDriver` — flag is currently ignored, but the underlying native-driver code path exists; just needs a flag check in `animated.js`'s `timing()`.
- `RefreshControl` / `KeyboardAvoidingView` — not wired yet. (`Switch`, `ActivityIndicator`, `SafeAreaView` landed; `Switch` / `ActivityIndicator` now have `MeasurableYogaNode` + `measureContent` so they don't collapse to 0×0 in flex layouts.)
- TurboModule manager (we use ad-hoc `rnLinux.*` JSI bindings instead).
- Clipboard / real Linking / Alert / AT-SPI2 accessibility.

## Phase 5 — Native runtime (`vnext/`)

### 5.1 — Build system

- [x] vnext/CMakeLists.txt, presets, dep modules, pkg-config exports
- [x] First green build on Ubuntu 24.04 aarch64 (Lima)
- [x] Pango + libsoup3 (soft dep) + Hermes via FetchContent

### 5.2 — Host / instance plumbing

- [x] `RNLinuxHost::start / stop / reload / reloadFromSource`
- [x] HermesRuntimeFactory + `withMicrotaskQueue(true)` + explicit drain after evaluate
- [x] Bundle loader (file:// works; http:// stub remains — for the bundle, not for `<Image>`)
- [x] Vendor + app two-bundle split; vendor pre-compiled to Hermes `.hbc`
- [ ] Dedicated JS thread (still single-threaded — `Runtime::executor` is synchronous)
- [ ] folly executor + g_idle_add cross-thread plumbing (single-threaded path covers MVP)

### 5.3 — Fabric integration

- [x] Descriptors: View, Paragraph, RawText, Text, ScrollView, Image, TextInput (our own cross-platform shadow node)
- [x] LinuxSchedulerDelegate (all six pure-virtuals)
- [x] SurfaceHandler lifecycle; `resizeRootSurface(w, h)` updates LayoutConstraints
- [x] Scheduler from a SchedulerToolbox (ContextContainer, ComponentRegistryFactory, RuntimeExecutor, noop EventBeat)
- [x] react_native_rn_renderer static lib with `-Wl,--whole-archive`

### 5.4 — Mounting layer (GTK4)

- [x] LinuxMountingManager: `performTransaction` walks `ShadowViewMutation`s; `postLayoutPass()` runs at end of transaction
- [x] LinuxComponentViewRegistry with virtual `postLayoutPass` hook
- [x] LinuxComponentView base: widget\_, updateProps, updateLayoutMetrics (gtk_fixed_move + set_size_request), mountChild / unmountChild
- [x] ViewComponentView (GtkFixed) — backgroundColor, borderRadius (per-corner), borderWidth (per-side), borderColor, opacity, all composed into one CSS load_from_string per update; GtkGestureClick wired to dispatchFabricClick
- [x] ParagraphComponentView (GtkLabel) — Pango markup from AttributedString fragments; textAlign → gtk_label_set_xalign
- [x] ScrollViewComponentView (GtkScrolledWindow + inner GtkFixed) — children mount into inner; postLayoutPass sizes the inner from children's bounding box; horizontal / showsScrollIndicator
- [x] ImageComponentView (GtkPicture) — file:// via gdk_texture_new_from_file; http(s) async via libsoup3; resizeMode → GtkContentFit
- [x] TextInputComponentView (GtkText) — placeholder, value, maxLength; "changed" signal → dispatchFabricChangeText; suppress signal during programmatic set
- [x] Root view: GtkFixed inside GtkApplicationWindow
- [x] Per-widget CSS provider; combined per-View stylesheet so background + radius + border coexist

### 5.5 — Event pipeline

- [x] GtkGestureClick on every View — `dispatchFabricClick(tag)` JSI registry
- [x] GtkText "changed" → `dispatchFabricChangeText(tag, text)` JSI registry
- [x] Scroll events — `dispatchFabricScroll` from GtkAdjustment value-changed → `rnLinux.fabricOnScroll(tag, fn)`, emits nativeEvent with contentOffset / contentSize / layoutMeasurement matching RN's shape
- [ ] Long-press / motion events
- [ ] Keyboard events on `<TextInput>` (onKeyPress, onSubmitEditing)
- [ ] Touch events synthesized from pointer
- [ ] Real Fabric `EventEmitter` plumbing (we use JSI registries keyed by tag — fine for MVP, won't survive nested gestures)
- [ ] React refs to host instances — currently crashes Fabric at startSurface; missing commitAttachRef/commitDetachRef in fabricHostConfig.js. We worked around this for Animated.View via a generated `nativeID` registered in a C++ map, but apps that ref their own Views will break.

### 5.6 — TurboModule infrastructure

- [ ] `TurboModuleManager` setup on the runtime
- [ ] CxxModule registration hook for autolinking
- [x] PlatformConstants returning Linux info (in `src/modules/PlatformConstants.cpp`)
- [x] AsyncStorage via JSI bindings (XDG JSON-on-disk, atomic save) — not a TurboModule yet
- [ ] Codegen integration — `Markers.h` stamp exists; real Props.h / ComponentDescriptors.h blocked on `@react-native/codegen` linux generator fork

### 5.7 — Logging + diagnostics

- [x] stderr backend
- [x] Crash handler (`std::set_terminate` + sigaction backtrace)
- [x] LogBox / RedBox UI in GTK — shared `ErrorBoundary` (in `@lucid-softworks/react-native-linux-expo/error-boundary`) used by `fabric.js` as a catch-all backstop AND by the `expo-router` shim per route. `componentDidCatch` sets `__rnLinuxRecoveredFromError`; `fabric.js`'s `tryMount` skips `performReactRefresh` on the next bundle re-eval and does a full `updateContainer` remount instead.
- [ ] LinuxLogger wired into LogBox JS-side

### 5.8 — DevTools / DX

- [x] Smooth hot reload: re-eval in same Hermes runtime (no GTK flash, no init delay). `rnLinux.reloadApp` defers via `g_idle_add` so re-eval runs outside the JS click handler; mount transactions queue at `G_PRIORITY_HIGH_IDLE` so they aren't starved by sustained rAF / input traffic.
- [x] Fast Refresh — `react-refresh` runtime + swc `jsc.transform.react.refresh = true`; state preserved across edits
- [x] HMR push socket — esbuild watch's onEnd pushes the new bundle directly to the playground over `$XDG_RUNTIME_DIR/rn-linux.<app-id>.sock`; the file-monitor reload is kept as fallback and suppressed for 500 ms after a socket push
- [x] esbuild bundler + per-file swc transform; tsx entry; sourcemaps inline
- [x] react-refresh global hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) injected before reconciler loads; rewritten via esbuild `define` so the bare-identifier check inside react-reconciler's strict-mode IIFE sees it
- [x] Hermes bytecode pre-compile for the vendor bundle (≈10 ms cold-start vendor eval)
- [ ] Metro WebSocket client (we use the HMR socket instead — same outcome)
- [ ] Hermes inspector port
- [ ] Cmd/Ctrl+R reload keybinding at the GTK level
- [ ] Performance overlay (FPS)

## Phase 9 — Component coverage

In priority order — `[x]` = wired today, `[~]` = present but with known gaps, `[ ]` = not started.

- [x] `View` / `Text` / `ScrollView` / `Image` / `TextInput` / `Pressable` / `Button` / `FlatList` / `Modal` (see status snapshot above)
- [x] `StyleSheet.create / flatten / compose / hairlineWidth / absoluteFill`
- [x] `Animated` (Value / timing / sequence / parallel / loop / interpolate / Easing) + `Animated.View / Text / Image / ScrollView` — JS driver default; native driver scaffolded (`rnLinux.setNativeProp` for opacity / transform.translateX/Y via `nativeID` side-channel) but useNativeDriver flag not yet honored
- [x] Platform.OS = 'linux', Platform.select; Dimensions / Appearance / useColorScheme stubs
- [x] HTTP image loading via libsoup-3 async fetch (process-wide SoupSession, dedup-by-uri via g_object_set_data tag)
- [x] AsyncStorage (`@react-native-async-storage/async-storage` import works) — full API as Promise-returning wrappers over synchronous rnLinux.storage\* JSI bindings
- [~] Inline `<Text>` styling — only one fontSize/color/etc. per Paragraph; mixed-style runs collapse
- [~] `numberOfLines` / `ellipsizeMode` — TextLayoutManager accepts them, host config doesn't pass them through yet
- [x] Window resize / maximize — viewport widget with a custom GtkLayoutManager (natural=(0,0), allocate-child-to-full-size) breaks the GtkFixed-children-bbox propagation; resize/maximize/restore push real (w, h) into `resizeRootSurface()` on every tick
- [ ] `tintColor` on Image (needs a custom GdkPaintable that colour-tints)
- [x] `Switch` → `GtkSwitch` (shadow node implements `measureContent` so flex siblings don't overlap)
- [x] `ActivityIndicator` → `GtkSpinner` (same `measureContent` story; uses 16×16 default)
- [ ] `RefreshControl`
- [ ] `KeyboardAvoidingView` (mostly no-op on desktop)
- [x] `SafeAreaView` — passthrough wrapper in `react-native-safe-area-context` shim
- [ ] `Modal` as a separate `GtkWindow` with `transient-for` instead of in-window overlay
- [x] `FlatList` virtualization — JS-side windowing via onScroll. Renders ~14 visible items + spacers preserving total scroll extent. Multi-column path skips windowing (item-size estimate ambiguous).
- [~] `Animated.useNativeDriver` — C++ side (`rnLinux.setNativeProp`) + JS dispatcher (`animated.js`) exist for opacity + transform.translateX/Y; honoring the `useNativeDriver: true` flag in `timing()` is the remaining hookup, plus per-frame batching so multiple property writes flush as one GTK invalidation
- [ ] `Linking.openURL` — `g_app_info_launch_default_for_uri`
- [ ] `Clipboard` — `gdk_clipboard_set_text`
- [ ] Real Dimensions backed by `gdk_monitor_*`
- [ ] Real Appearance (`gtk-application-prefer-dark-theme` / `AdwStyleManager`)
- [ ] `AccessibilityInfo` via AT-SPI2
- [ ] `Alert` → `GtkAlertDialog`

## Phase 10 — Stretch / nice-to-haves

- [ ] libadwaita widgets
- [ ] Wayland CSD + GtkIMContext IME
- [ ] Multi-window via multiple `SurfaceHandler` instances
- [ ] D-Bus TurboModule (notifications, secrets)
- [ ] GtkFileDialog
- [ ] System tray (libayatana-appindicator)
- [ ] Auto-update
- [ ] gstreamer `<Video>`
- [ ] WebKitGTK `<WebView>`
- [ ] Reanimated 3 audit
- [ ] Skia path (drop GTK, render directly) — long-term alternative

## Immediate next actions

In priority order toward "drop a real RN app in and have it work":

1. **Try a real app harness** — pull a non-trivial Expo screen or `react-native-paper` showcase into `apps/`. The "honest gaps" list below is best-guess; running real code reveals the actual blockers. **This re-orders everything else, so do it first.**
2. **TurboModule manager** — replace ad-hoc `rnLinux.*` JSI registrations with a proper TurboModule pipeline. Unblocks autolinking third-party native modules — required for anything beyond first-party shims (NetInfo, the @react-native-community packages, …).
3. **`numberOfLines` / `ellipsizeMode`** — forward from ParagraphAttributes (TextLayoutManager already honours them) to GtkLabel's `set_lines` / `set_ellipsize`. Text-heavy apps look very wrong without this.
4. **Inline nested `<Text>` styling** — Fabric collapses our intermediate Text shadow nodes into duplicate Paragraph creates. Read BaseTextShadowNode's `dynamic_cast` path; probably a `LeafYogaNode` / `Trait::FormsView` thing. RN apps mix bold/colored fragments inside one `<Text>` constantly.
5. **`RefreshControl`** — GtkScrolledWindow's "edge-reached" signal. A few hundred lines.
6. **Honor `Animated.useNativeDriver: true`** — code path exists; flag dispatch + per-frame batching to coalesce setNativeProp calls into one GTK invalidation.
7. **`tintColor`** — custom GdkPaintable that delegates to source paintable but masks with a colour. Common in icon-heavy UIs.
8. **Long-press, real Fabric EventEmitter, keyboard events** — once the simpler components are landing, gesture coverage starts mattering for parity.

Resize lag and FPS perf are real but second-order: the app needs to RUN before being smooth matters. The perf scaffolding from earlier sessions (CSS cache, opacity cache, set_size_request diff, paint-only transforms, FlatList virtualization, Hermes stack bump, TurboVNC) gives a healthy floor; bare-metal Linux is the final unblock for 60 FPS regardless.

## Production-ready gaps (beyond MVP)

Once arbitrary RN apps load and run, the structural things between "works" and "ship to users":

- **Real-app harness** — a published demo or two living under `apps/`, run on every CI build, gating merges on visible regression. The cheapest production-readiness signal you can get.
- **TurboModule manager + codegen** — third-party native modules can't autolink today. Lots of common libraries (FBSDK, MMKV, RNFS, sentry-react-native, …) need this. Blocks any RN ecosystem package with a `react-native.config.js`.
- **Dedicated JS thread** — currently single-threaded, JS work runs on the GTK main loop. Doesn't matter at MVP scale but real apps will jank under sustained load (large lists, complex animations, heavy effects). Bigger refactor — touches `RuntimeExecutor`, `g_idle_add` crossing, every JSI binding's threading assumption.
- **Accessibility (AT-SPI2)** — hard requirement for enterprise / regulated / EU-accessibility-act-affected shipping. Currently `AccessibilityInfo` is a stub. The schedulerDidSendAccessibilityEvent hook exists but doesn't emit through AT-SPI.
- **Distro packaging** — AppImage script exists. Flatpak + .deb/.rpm + Snap are how Linux desktop apps actually ship in 2026. A `react-native-linux pack --target=flatpak` CLI subcommand wrapping flatpak-builder is the right shape.
- **Hermes inspector** — Chrome DevTools attach for production-grade debugging. Port-bind + websocket bridge.
- **CI on real hardware** — Lima/QEMU CI is fine for headless build verification but the FPS / GPU paths only show on real GTK. A self-hosted Linux runner with a real X/Wayland session would catch perf regressions invisible to the VM.

## Open questions

- [ ] Does Hermes need any patches for glibc / musl? (Decide once a non-Lima build runs.)
- [ ] Yoga CMake export when consumed externally? (Verify when the template builds against a published `@lucid-softworks/react-native-linux` rather than via add_subdirectory.)
- [x] JS thread model — single-threaded works for the MVP; revisit if/when an app spawns long-running JS work.

---

## Phase 0–4 (locked in, all done)

Build system / repo / template / CLI / JS package — all the bootstrap work landed during the first wave. See git log up to commit `66fd9050` for the historical sequence; the live status above is what matters now.

- [x] All Phase 0 decisions
- [x] All Phase 1 repo + tooling (lint, format, husky, dependabot, docs)
- [x] All Phase 2 JS package (Platform.linux.js, View.linux.js, Text.linux.js, codegen specs, types, jest)
- [x] All Phase 3 CLI (`run-linux`, `bundle-linux`, `init-linux`, `log-linux`, `autolink-linux`)
- [x] All Phase 4 template (sans `template/linux/icons/` placeholders)
- [x] All Phase 6 playground (rich demo; see `apps/playground/index.tsx`)
- [x] All Phase 7 testing (jest preset, googletest, xvfb e2e harness, CI matrix)
- [x] All Phase 8 distribution (release-please + npm publish + AppImage script)
