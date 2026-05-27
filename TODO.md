# react-native-linux — MVP Roadmap

Decisions locked in (2026-05-21):

- **UI toolkit:** GTK4 (via `gtk4` + optionally `libadwaita-1` later)
- **JS engine:** Hermes (vendor bundle pre-compiled to `.hbc` for fast cold start)
- **Architecture:** Fabric (Scheduler + cloneNodeWithNewProps persistent mode)
- **Repo layout:** Monorepo, mirroring `microsoft/react-native-windows` (`vnext/` + `packages/*`)
- **Target RN version:** `^0.81`

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
- Resize → Yoga commit fires inline from the `GdkFrameClock` tick callback in `RNLinuxApplication.cpp` (was a 33 ms `g_timeout_add`; removed once JS moved to the worker — the timer doubled the latency between drag pixel and repositioned children, which showed up as resize artifacts that took 40–70 ms to clear). Dedupe via `lastWidth/lastHeight` keeps steady-state ticks cheap.
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
- [x] Dedicated JS thread — Hermes runs on its own pthread (`vnext/src/jsi/JsThread.{h,cpp}`); RuntimeExecutor posts onto it, sync fast-path when called from the worker itself
- [x] g*idle_add cross-thread plumbing — SchedulerDelegate uses `g_main_context_invoke_full(g_main_context_default(), …)` for JS → main mount hops; worker pushes main GMainContext as thread-default so GIO async (libsoup, gdk_clipboard_read*\*\_async, g_timeout_add) lands on the main loop

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

### 5.9 — Off-load blocking native work from the JS worker

Now that Hermes runs on its own pthread, every blocking native module that's reachable from JSI freezes the JS thread for the duration — React's scheduler can't pump, dispatch\* events queue up, fetch completions back up. Audit ordered by impact (file:line; thread today → target thread):

- [x] **SecureStore async variants** (`vnext/src/jsi/RnLinuxBindings.cpp:2780+` → `vnext/src/securestore/SecureStore.cpp`) — `secret_password_*_sync` blocks 0.5–5 s on keyring prompts. New `secureStoreSetItemAsync` / `secureStoreGetItemAsync` / `secureStoreDeleteItemAsync` bindings spawn a detached `std::thread` for the libsecret call and post the JS callback back through `state().executor`. Sync variants kept for bootstrap-time hydration paths. JS shim (`expo-secure-store.js`) routes `setItemAsync` / `getItemAsync` / `deleteItemAsync` through the new bindings.
- [x] **Location signal callbacks** (`vnext/src/jsi/RnLinuxBindings.cpp:2515+`) — onFix / onError fired from the main thread; now hop to the worker via executor before touching the runtime.
- [ ] **Location D-Bus setup** (`vnext/src/location/Location.cpp:89–150+`) — `g_bus_get_sync` + `g_dbus_connection_call_sync` block 500–2000 ms on first connection; needs `LocationClient` to expose an async start variant (or move the JSI bindings to a `std::thread` like SecureStore) so `locationStartWatch` doesn't pin the JS thread on cold start.
- [ ] **AsyncStorage I/O** (`vnext/src/storage/AsyncStorage.cpp` + `vnext/src/jsi/RnLinuxBindings.cpp:1472`) — sync `ifstream` / `ofstream` + JSON round-trip on every key. First read on cold start blocks; every write rewrites the whole store. Should post to a worker thread; consider SQLite once the key set grows.
- [ ] **Image `data:` URI decode** (`vnext/src/views/ImageComponentView.cpp:72–105`) — `gdk_pixbuf_loader_write` is synchronous inside the mount commit. Sub-5 ms for 4 KB logos, can be 50 ms+ for larger payloads. Should GTask off + texture-via-callback into the component view.
- [ ] **Print / PDF export** (`vnext/src/print/Print.cpp:149–219`) — sync Pango + Cairo render; 100–500 ms for a 100-page doc. Worker thread + progress-on-main idle.
- [ ] **Crypto digest** (`vnext/src/jsi/RnLinuxBindings.cpp:1633`) — sync SHA + base64 on large blobs. Threshold-gated (>1 MB) worker dispatch.
- [ ] **Download read loop** (`vnext/src/filesystem/FileSystem.cpp:373–461`) — `g_input_stream_read` in `onSoupSendFinish` ties the main loop up for multi-MB downloads. Should be a GTask with progress on main idle.
- [ ] **Per-view `updateProps` profiling** (`vnext/src/fabric/LinuxMountingManager.cpp:23–86`) — current profile rolls per-transaction times; can't drill into which component made a commit slow. Add per-view timing + log outliers >5 ms.
- [ ] **Pango text-measure cache hit rate** (`vnext/src/text/TextLayoutManager.cpp:78–148`) — cache exists; verify >90 % hit rate on a feed scroll; pre-warm common app text if low.

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

## Expo module backlog (real backends, not stubs)

Already real-implemented and demoable in `apps/playground/smoke-demo.tsx`:
`@react-native-async-storage/async-storage` (XDG JSON file),
`react-native-device-info` (DMI + /proc + /sys + /etc),
`react-native-safe-area-context` (live window dims),
`expo-camera` (GStreamer appsink → GdkMemoryTexture; v4l2src/videotestsrc fallback; pngenc snap),
`expo-location` (GeoClue2 via DBus + auto-spawn demo agent),
`expo-notifications` (libnotify → freedesktop notification daemon),
`expo-file-system` (POSIX direct + libsoup downloads; XDG paths),
`expo-clipboard` (GdkClipboard set/get; cross-app reads and image/HTML round-trip still on the gap list),
`expo-secure-store` (libsecret → gnome-keyring/kwallet/KeePassXC; session-collection fallback on headless),
`expo-localization` (LC\_\*/LANG parsing + nl_langinfo + /etc/timezone + CLDR-equivalent region heuristics),
`expo-haptics` (gdk_display_beep on every kind — silent in VM, real on hardware where the WM/sound theme acts on it),
`expo-keep-awake` (systemd-logind Manager.Inhibit("idle:sleep") on the system bus; tag-keyed; auto-released on bundle reload),
`expo-network` (GNetworkMonitor for up/internet + /sys/class/net for interface type + IP + MAC; NM-or-netlink-fallback),
`expo-battery` (reuses /sys/class/power_supply path from device-info; UNKNOWN on machines without a battery),
`expo-sharing` (routes shareAsync through rnLinux.openURL → xdg-mime default handler),
`expo-document-picker` + `expo-image-picker` (shared GtkFileDialog backend; image-picker chains launchCameraAsync into the existing cameraSnap),
`expo-print` (GtkPrintOperation dialog + cairo-PDF surface; HTML→plaintext stripping pending a WebKitGTK render path),
`expo-screen-capture` (honest Linux no-op — no portable "secure window" hint exists across X11/Wayland compositors),
`expo-image` (JS-only wrap over RN.Image; contentFit↔resizeMode; advanced extras pending a native Fabric component).

Next-up real implementations, ordered by effort × ecosystem demand. Each is its own `feat(expo-…)` PR with a `docs/realworld-expo-…md` matching the existing pattern. **No JS-only stubs** — full Linux backends.

- [x] **`expo-clipboard`** — DONE 2026-05-26. See `docs/realworld-expo-clipboard.md`. Gaps: cross-app reads (need async gdk_clipboard_read_text), image/HTML round-trip, change listener.
- [x] **`expo-localization`** — DONE 2026-05-26. See `docs/realworld-expo-localization.md`. Gaps: `nl_langinfo` requires the locale to be generated (bare `C.UTF-8` VMs get region fallback but empty currency); calendar detection is hardcoded to gregorian; `firstWeekday` hardcoded to Monday.
- [x] **`expo-haptics`** — DONE 2026-05-26. See `docs/realworld-expo-haptics.md`. All styles collapse to a single `gdk_display_beep`.
- [x] **`expo-keep-awake`** — DONE 2026-05-26. See `docs/realworld-expo-keep-awake.md`. Backed by systemd-logind (more universal than session-bus ScreenSaver). Gaps: delay mode, portal fallback for Flatpak, non-systemd distros (Devuan/Void/Alpine).
- [x] **`expo-file-system`** — DONE 2026-05-26. See `docs/realworld-expo-file-system.md`. Gaps: resumable downloads, uploads, statvfs-backed disk-space helpers.
- [x] **`expo-secure-store`** — DONE 2026-05-26. See `docs/realworld-expo-secure-store.md`. Gaps: auto-create login collection on first use, biometric prompts (KWallet PAM), per-app keychainService isolation.
- [x] **`expo-network`** — DONE 2026-05-26. See `docs/realworld-expo-network.md`. GNetworkMonitor (auto-picks NM/netlink) + sysfs. Gaps: live network-changed subscription, per-interface enumeration, airplane-mode via rfkill.
- [x] **`expo-image`** — DONE 2026-05-26 as a JS-only wrap over RN.Image. See `docs/realworld-expo-image.md`. Real load/display/contentFit; placeholder/transition/cachePolicy/blurRadius are accepted-but-discarded. Native Fabric component with cross-fade GdkPaintable is the follow-up if real apps lean on those features.
- [x] **`expo-document-picker`** — DONE 2026-05-26. See `docs/realworld-expo-pickers.md`. GtkFileDialog (GTK 4.10+) shared with expo-image-picker.
- [x] **`expo-image-picker`** — DONE 2026-05-26. Same GtkFileDialog backend; launchCameraAsync chains into the existing rnLinux.cameraSnap pipeline.
- [x] **`expo-sharing`** — DONE 2026-05-26. See `docs/realworld-expo-battery-sharing.md`. Currently uses `g_app_info_launch_default_for_uri` (single default app per MIME); real picker via xdg-desktop-portal OpenURI is the planned follow-up for sandboxed apps.
- [ ] **`expo-sensors`** — accelerometer / gyro / magnetometer don't exist on most desktops. iio-sensor-proxy can surface laptop accelerometers on some devices, but coverage is poor. **Skip until there's user demand**, then implement against iio-sensor-proxy over DBus with a clean "no sensors available" error path.
- [x] **`expo-battery`** — DONE 2026-05-26. See `docs/realworld-expo-battery-sharing.md`. Reuses the DeviceInfo /sys/class/power_supply path; live UPower subscription is a follow-up.
- [x] **`expo-print`** — DONE 2026-05-26. See `docs/realworld-expo-print.md`. GtkPrintOperation + cairo PDF; HTML→plaintext stripping (WebKitGTK HTML render path is the planned follow-up).
- [x] **`expo-screen-capture`** — DONE 2026-05-26 as an honest no-op. See `docs/realworld-expo-screen-capture.md`. Upstream API is about PREVENTING capture, not doing it; no portable Linux mechanism exists. Future improvements: xdg-desktop-portal opt-out for sandboxed apps, wp-security-context-v1 on supporting Wayland compositors.
- [ ] **`expo-cellular`** / **`expo-sms`** — no telephony on desktop. Return realistic "no SIM" / "not available" responses (not stubs that lie about success).

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
- **Off-thread native modules** — the JS thread split landed (Phase 5.8), but blocking native calls (SecureStore D-Bus, Location D-Bus, AsyncStorage I/O, Print/Cairo, large image decodes, crypto on big blobs, multi-MB downloads) still pin the JS worker or main thread. Plan + status per call site in Phase 5.9 above.
- **Accessibility (AT-SPI2)** — hard requirement for enterprise / regulated / EU-accessibility-act-affected shipping. Currently `AccessibilityInfo` is a stub. The schedulerDidSendAccessibilityEvent hook exists but doesn't emit through AT-SPI.
- **Distro packaging** — AppImage script and `.deb` packager both exist; CLI exposes them via `react-native pack-linux --target=deb|appimage` (defaults pulled from `package.json`). Flatpak / Snap / `.rpm` still open — each ~50–100 lines of script following the same shape as `scripts/package/deb.sh`. See `docs/packaging.md`.
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
