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

- **Window resize:** the tick callback queries `gtk_widget_get_height(window)`, which returns content request (≈5446 px when the FlatList expands its content) instead of the viewport. Layout grows past the monitor. Pick a different signal source (probably `gtk_widget_get_allocated_height` on the GtkFixed after subtracting decorations, or hook `GdkSurface::layout`).

Honest gaps for arbitrary RN apps to drop in:

- Inline nested `<Text>` for mixed-style runs (Fabric collapses our intermediate Text shadow nodes; one Paragraph per outer `<Text>` today).
- `tintColor` on Image (needs a custom GdkPaintable subclass).
- `numberOfLines` / `ellipsizeMode` plumbed from Paragraph props (TextLayoutManager already accepts them).
- `Animated.useNativeDriver` — silently ignored.
- `Switch` / `ActivityIndicator` / `RefreshControl` / `KeyboardAvoidingView` / `SafeAreaView` — not wired yet.
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
- [x] LinuxComponentView base: widget_, updateProps, updateLayoutMetrics (gtk_fixed_move + set_size_request), mountChild / unmountChild
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
- [ ] Long-press / motion / scroll events
- [ ] Keyboard events on `<TextInput>` (onKeyPress, onSubmitEditing)
- [ ] Touch events synthesized from pointer
- [ ] Real Fabric `EventEmitter` plumbing (we use JSI registries keyed by tag — fine for MVP, won't survive nested gestures)

### 5.6 — TurboModule infrastructure

- [ ] `TurboModuleManager` setup on the runtime
- [ ] CxxModule registration hook for autolinking
- [x] PlatformConstants returning Linux info (in `src/modules/PlatformConstants.cpp`)
- [x] AsyncStorage via JSI bindings (XDG JSON-on-disk, atomic save) — not a TurboModule yet
- [ ] Codegen integration — `Markers.h` stamp exists; real Props.h / ComponentDescriptors.h blocked on `@react-native/codegen` linux generator fork

### 5.7 — Logging + diagnostics

- [x] stderr backend
- [x] Crash handler (`std::set_terminate` + sigaction backtrace)
- [ ] LogBox / RedBox UI in GTK
- [ ] LinuxLogger wired into LogBox JS-side

### 5.8 — DevTools / DX

- [x] Smooth hot reload: re-eval in same Hermes runtime (no GTK flash, no init delay)
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
- [x] `Animated` (Value / timing / sequence / parallel / loop / interpolate / Easing) + `Animated.View / Text / Image / ScrollView` — JS driver only
- [x] Platform.OS = 'linux', Platform.select; Dimensions / Appearance / useColorScheme stubs
- [x] HTTP image loading via libsoup-3 async fetch (process-wide SoupSession, dedup-by-uri via g_object_set_data tag)
- [x] AsyncStorage (`@react-native-async-storage/async-storage` import works) — full API as Promise-returning wrappers over synchronous rnLinux.storage* JSI bindings
- [~] Inline `<Text>` styling — only one fontSize/color/etc. per Paragraph; mixed-style runs collapse
- [~] `numberOfLines` / `ellipsizeMode` — TextLayoutManager accepts them, host config doesn't pass them through yet
- [~] Window resize — initial render fits, larger window grows the constraint but tick callback returns content size not viewport (see Status snapshot)
- [ ] `tintColor` on Image (needs a custom GdkPaintable that colour-tints)
- [ ] `Switch` → `GtkSwitch`
- [ ] `ActivityIndicator` → `GtkSpinner`
- [ ] `RefreshControl`
- [ ] `KeyboardAvoidingView` (mostly no-op on desktop)
- [ ] `SafeAreaView` (no-op on desktop, but apps import it so a passthrough wrapper helps)
- [ ] `Modal` as a separate `GtkWindow` with `transient-for` instead of in-window overlay
- [ ] `FlatList` virtualization (today the JS shim renders all items inline)
- [ ] `Animated.useNativeDriver` — silently ignored; either implement on the C++ side or warn loudly
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

In priority order, what would move the needle most for "real apps drop in":

1. **Fix window resize**: tick callback queries the wrong widget. Probably swap to `gtk_widget_get_allocated_width / height` on the rootView (GtkFixed) but pin its `set_size_request` to (0, 0) so the WIDGET allocation reflects the window's viewport rather than its content's natural size. Or hook GdkSurface's `layout` signal on `gtk_native_get_surface(window)`.
2. **`numberOfLines` plumbing**: forward from Paragraph props to GtkLabel's `set_lines` / `set_ellipsize`. The TextLayoutManager already honours ParagraphAttributes.maximumNumberOfLines.
3. **`SafeAreaView`** as a passthrough View (3 lines of JS); apps import it but on desktop it can be a no-op.
4. **Inline nested `<Text>` styling**: figure out why Fabric collapses our intermediate Text shadow nodes into duplicate Paragraph creates in the mutation stream. Probably a `LeafYogaNode` trait or `Trait::FormsView` thing on TextShadowNode that we're missing — re-read the BaseTextShadowNode dynamic_cast path.
5. **`Switch` + `ActivityIndicator`**: small, direct GTK wrappers.
6. **TurboModule manager**: replace ad-hoc `rnLinux.*` JSI registrations with a proper TurboModule pipeline. Unblocks autolinking third-party native modules.
7. **`tintColor`**: custom GdkPaintable that delegates to source paintable but masks with a colour.
8. **Try a real app**: pull `react-native-paper` or a basic Expo screen and see what's left to add.

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
