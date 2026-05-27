# akari shim roadmap

[akari](https://github.com/lucid-softworks/akari) is the reference
real-world Expo app we use to drive shim work in react-native-linux.
It's an atproto/Bluesky client built on Expo 54 + RN 0.81 + expo-router
6 — broad enough to exercise most of the Expo ecosystem and demanding
enough (chat, video, gestures, WebRTC) to expose every gap.

This doc tracks every external package akari imports, our current
coverage, and what shimming each gap would entail. New shims land in
`packages/@lucid-softworks/react-native-linux-expo/` with the same
package-name basename so the Metro alias table picks them up
automatically.

Status legend:

- ✓ **Shimmed** — works in the playground harness today
- ◐ **Stub** — accepted at import time but throws or no-ops on use
- ✗ **Missing** — import errors at bundle time
- ⚠ **Untested with akari** — shim exists but hasn't been exercised against akari's specific usage patterns

## Quick smoke result

Last attempted: 2026-05-27. **Akari boots to first render.** The window
mounts with akari's `DevPerformanceOverlay` (~56 FPS, 17.7ms frametime)
and the outer provider stack — `LanguageProvider` → `PlausibleProvider`
→ `ToastProvider` → `DialogProvider` → `ThemeProvider` →
`ExternalLinkConfirmHost` → `AppProviders` → `QueryClient` /
`PersistQueryClient` → `SafeAreaProvider` → `GestureHandlerRootView` —
all mount clean.

The router itself shows
`No component for "(auth)". Pass <...Screen component={...} /> or wrap
in a layout.` This is expected: our expo-router shim doesn't walk
`require.context()` to gather `app/(auth)/_layout.tsx` and
`app/(tabs)/_layout.tsx` the way real expo-router does. That's the
next gap.

The smoke harness lives in `/tmp/akari/` and is **not** in the repo —
akari is the test subject, not a shipped dependency.

### What we learned during the boot

These are not akari-specific. They affect every Expo app we try to host.

- **Vendor React was 18.3.1; akari (and any modern Expo 54 / RN 0.81
  app) uses React 19's `React.use(context)`.** During the smoke we
  polyfilled it as `useContext` via a side-effect import that ran
  _before_ hoisted ES imports — the only way to land on the React
  module before every downstream `__toESM(require('react'))`
  enumerates own keys. The repo has since moved to React 19.1.7 + RN
  0.81 + matching Hermes, so the polyfill is no longer needed.
- **esbuild's `__toESM` wrapper enumerates own keys via
  `Object.getOwnPropertyNames`.** A lazy Proxy `get` trap is invisible
  to that call, so any stub fronting a function with a per-property
  `get` trap loses every named export through the CJS-to-ESM bridge.
  Stubs need either eager properties or explicit `ownKeys` +
  `getOwnPropertyDescriptor` traps.
- **Stub container components must render `<View>{children}</View>`,
  not return `null`.** A null-returning `GestureHandlerRootView`
  hides the entire app tree.
- **Hermes 0.12 chokes on esbuild's CJS-interop output.** Specifically:
  esbuild's `class extends (_X = expr)` rewrite (used by `__toESM`)
  and any top-level `async (…) =>` arrow expression both crash the
  Hermes 0.12 parser. We blanket-lowered non-user-code to ES5 via swc
  to dodge both. **Retired now** — the Hermes that ships with RN 0.81
  (commit `e0fc6714…`) handles modern JS, and the playground bundle
  builds + boots without lowering.
- **Per-iteration `let`/`const` in for-of loops mis-compiled closures**
  under Hermes 0.12 — esbuild's own `__copyProps` helper hit this. The
  playground build still applies a `forEach` rewrite as a safety net;
  if the new Hermes also fixed this (likely), the patch becomes a
  no-op and can come down later.

### Runtime bug surfaced

When a JS render exception propagates out of the React tree during
`UIManager::startSurface`, the C++ side calls `std::terminate` and the
whole process aborts — even though the React ErrorBoundary above
caught it cleanly and the runtime had recovered. The host's
`surface.start()` call now wraps the synchronous path in
try/catch, but the throw originates inside `UIManager::startSurface`
itself (which is `noexcept`) so we still can't catch it from outside.
Real fix lives inside the UIManager / our `RuntimeExecutor` —
`runtimeExecutor` runs the lambda body inline, so any JSI exception
the body throws escapes a `noexcept` boundary. **Open follow-up**:
wrap the host's `runtimeExecutor` lambda in a catch so we never throw
through `noexcept` again.

### React 19 / RN 0.81 bump notes

The bump landed in [commit history TBD]. Highlights:

- React 18.3.1 → 19.1.7, react-reconciler 0.29.2 → 0.32.0,
  react-native ^0.76 → ^0.81, plus `@react-native/babel-preset` and
  `@react-native/metro-config` to ^0.81 and `@react-native-community/cli`
  to ^20.
- Hermes commit bumped to the one RN 0.81 ships (read from
  `node_modules/react-native/sdks/.hermesversion`).
- Folly tag bumped to `v2024.11.18.00` (RN 0.81's CocoaPods pin).
- New FetchContent module for `fast_float` v8.0.0 — RN 0.81's CSS
  tokenizer needs APIs that landed in fast_float 6.x. Ubuntu's
  `libfast-float-dev` 3.9.0 stays installed for Folly's own internal
  use; the renderer gets the v8 headers via the FetchContent target.
- Several new `platform/cxx` include paths picked up: scrollview,
  text, modal, react/utils, runtimeexecutor — RN 0.81 split per-
  component / per-module host indirection across new subdirs.
- `react/config/ReactNativeConfig.h` removed — replaced by the
  global `ReactNativeFeatureFlags` singleton.
- `SchedulerToolbox::asynchronousEventBeatFactory` became a single
  `eventBeatFactory` and `EventBeat` now needs a `RuntimeScheduler&`
  in its ctor. Host now owns a `RuntimeScheduler` and registers it
  into `ContextContainer` under `RuntimeSchedulerKey` (the Scheduler
  asserts on `find<weak_ptr<RuntimeScheduler>>`).
- `MountingCoordinator::Shared` → `std::shared_ptr<const
MountingCoordinator>` in the delegate signatures.
- `ShadowViewMutation::parentShadowView` field removed; use
  `parentTag` directly.
- Two new pure virtuals on `SchedulerDelegate`:
  `schedulerShouldSynchronouslyUpdateViewOnUIThread` and
  `schedulerDidUpdateShadowTree`.
- `JSExecutor::performanceNow()` became a free function
  `facebook::react::performanceNow()`, and the
  `chronoToDOMHighResTimeStamp` helper is gone — use
  `(HighResTimeStamp::now() - HighResTimeStamp{})
.toDOMHighResTimeStamp()`.
- New required source files on the renderer link:
  `react/renderer/mounting/internal/*.cpp` (CullingContext),
  `runtimeexecutor/platform/cxx/.../RuntimeExecutorSyncUIThreadUtils.cpp`,
  `jsinspector-modern/tracing/{PerformanceTracer,EventLoopReporter}.cpp`,
  `oscompat/OSCompatPosix.cpp`. The shared library also needs
  `-latomic` for `std::atomic<std::optional<double>>` on aarch64.
- React 19 reconciler config picked up new host hooks:
  `getCurrentUpdatePriority`/`setCurrentUpdatePriority`/`resolveUpdatePriority`,
  `maySuspendCommit`, `preloadInstance`, `startSuspendingCommit`,
  `suspendInstance`, `waitForCommitToBeReady`,
  `requestPostPaintCallback`, `NotPendingTransition`,
  `HostTransitionContext`, `resetFormInstance`, `bindToConsole`. All
  no-op except the priority register, which holds a single number.

After bump the playground bundle is 158 kB / vendor 2.9 MB (was 3.5 MB),
boots cleanly, and renders 287-mutation cold mount with sustained
60 Hz raf in the rich demo. A non-fatal `rAF threw: NaN is not a
function` in the cross-fade animation helper still appears once on
mount — likely a strictness change in React 19's scheduling layer
that surfaces a NaN where the old reconciler was lax. Not a blocker.

## Ecosystem packages

### Already shimmed (works for akari's surface)

| Package                          | Status | Notes                                                                                          |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `expo` (core)                    | ✓      | Boots, registerRootComponent works                                                             |
| `expo-clipboard`                 | ✓      | Text + image + HTML + file-list + listener                                                     |
| `expo-constants`                 | ✓      | App constants + linking URL                                                                    |
| `expo-font`                      | ✓      | useFonts no-op (system fonts via Pango)                                                        |
| `expo-haptics`                   | ✓      | gdk_display_beep — all `impactAsync` styles collapse to one bell tone today                    |
| `expo-image`                     | ✓      | RN.Image-backed; responsive picker + animated GIF/WebP                                         |
| `expo-image-picker`              | ✓      | GtkFileDialog + cameraSnap; copyToCacheDirectory; video duration via GstDiscoverer             |
| `expo-localization`              | ✓      | libc nl_langinfo + CLDR-equivalent region tables + live `/etc/locale.conf` watch               |
| `expo-notifications`             | ✓      | libnotify; categories with actions; daily/weekly/calendar triggers                             |
| `expo-router`                    | ⚠      | Shim exists (451 lines) but akari's nested `(auth)` / `(tabs)` route-group layout not verified |
| `expo-secure-store`              | ✓      | libsecret with auto-create of the default collection                                           |
| `expo-status-bar`                | ✓      | No-op (no system status bar on the Linux window chrome)                                        |
| `expo-symbols`                   | ✓      | Mapped to lucide via the symbol table; akari uses `MaterialIcons` so this path overlaps        |
| `expo-web-browser`               | ✓      | Wraps `xdg-open` via GIO `g_app_info_launch_default_for_uri`                                   |
| `react-native-safe-area-context` | ✓      | Zero insets on bare Linux windows; SafeAreaProvider mounts cleanly                             |
| `react-native-reanimated`        | ⚠      | Basic shim; akari requires v4 (worklets 0.5.1) which we haven't verified end-to-end            |

### Small shim gaps (≤1 day each)

| Package                           | Status          | Plan                                                                                                                                                                                                                                                      |
| --------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo-application`                | ✓               | App id, version, build, install-time. Pulled from DeviceInfo's snapshot + `RN_LINUX_APP_*` env vars                                                                                                                                                       |
| `expo-crypto`                     | ✓               | `getRandomValues` via `getrandom(2)`; `digestStringAsync` via `GChecksum` (SHA-1/256/384/512 + MD5); `randomUUID` via `g_uuid_string_random`. DPoP signing works.                                                                                         |
| `expo-device`                     | ✓               | DeviceInfo fields reshaped under expo-device's API names. `deviceType` is always `DESKTOP` on Linux.                                                                                                                                                      |
| `expo-watermark`                  | ✓ (passthrough) | Renders children as a plain View. Screen-recording protection isn't possible — X11/Wayland expose no per-window "exclude from capture" hint                                                                                                               |
| `expo-file-system/legacy`         | ✓               | Re-export of `expo-file-system`                                                                                                                                                                                                                           |
| `react-native-mmkv`               | ✓               | Wraps `rnLinux.storage*` with per-instance key namespacing. Type-tagged value encoding so getString/getNumber/getBoolean/getBuffer round-trip. Listeners fan out on set/delete. `recrypt`/`trim` are no-ops — XDG per-user file perms gate access already |
| `@react-native-community/netinfo` | ✓               | Wraps expo-network listener fan-out. Single GNetworkMonitor subscription serves both shims                                                                                                                                                                |

### Medium shim gaps (1-3 days each)

Substantial native work, often a new Fabric component or DBus client.

| Package                             | Plan                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo-blur` / `BlurView`            | Custom `GdkPaintable` subclass that runs a cairo Gaussian blur over its child paintable. GTK4 has no built-in blur primitive                                                                                                                                                                  |
| `expo-video` / `react-native-video` | Fabric video component wrapping `GtkMediaFile` (we already use it for animated GIF/WebP). Need to surface `play()`/`pause()`/`seek()` from JS; props for `source`, `paused`, `repeat`, `volume`. HLS playback comes for free via GStreamer plugins. **Blocker for akari's media-heavy feeds** |
| `react-native-gesture-handler`      | Pan/pinch/tap/swipe via `GtkGestureClick` / `GtkGestureDrag` / `GtkGesturePinch`. We have a stub `GestureHandlerRootView` that just renders children, but akari's gesture-heavy chat/feed needs the real recognizers                                                                          |
| `react-native-worklets` (0.5.1)     | Required by reanimated v4. Runs JS functions on a separate "worklet" thread — fundamentally hard on our single-threaded Hermes + GTK setup. Likely landing as "worklets run on the JS thread, but the API shape matches so callers don't break"                                               |
| `@shopify/flash-list`               | Virtualized list. Pure JS but performance-critical; needs view recycling that maps to our Fabric layer. Likely falls back to a `FlatList`-shaped wrapper that just renders the visible window                                                                                                 |
| `lucide-react-native`               | Icon set that uses `react-native-svg` under the hood. Need a basic `react-native-svg` shim first (could back with `librsvg` via a Fabric component or render to a paintable)                                                                                                                  |
| `react-native-svg`                  | Prerequisite for lucide. SVG → `GdkTexture` via librsvg's `rsvg_handle_render_cairo`                                                                                                                                                                                                          |
| `rn-emoji-keyboard`                 | Pure JS but uses lots of RN primitives we may not handle (gesture handler, etc.). Verify after gesture handler lands                                                                                                                                                                          |
| `react-simple-pull-to-refresh`      | Looks like pure JS with a CSS animation; should just work once gesture handler is real                                                                                                                                                                                                        |

### Large shim gaps (deal-breakers without major investment)

| Package                | Why it's hard                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `react-native-webview` | Needs WebKitGTK embedded as a Fabric component. WebKitGTK is ~50 MB on disk, has its own GTK widget tree, and exposing the JS bridge `<→>` WebView JS context is involved. Multi-week port |
| `react-native-webrtc`  | Depends on libwebrtc (~1 GB build). Multi-week port even with a system libwebrtc available                                                                                                 |
| `@sentry/react-native` | Has its own native crash handler that collides with ours. Realistic move: stub the JS API to no-op rather than attempt a real Sentry Linux backend                                         |
| `expo-blur` (alt path) | If a real Gaussian blur is needed (not the small-shim above), a GdkPaintable + GLSL shader takes more like a week than a day                                                               |

### Pure-JS deps (no shim needed, should just bundle)

These are bundle-and-go — Hermes runs them as-is once the dependency
chain resolves:

- `@atcute/bluesky-richtext-parser`
- `@keytrace/claims`
- `@noble/curves`, `@noble/hashes` (used for DPoP signing — relies on `getRandomValues` from `expo-crypto`)
- `@tanstack/react-query` (and `-devtools`, `-persist-client`, `-virtual`)
- `@react-navigation/bottom-tabs`, `/elements`, `/native` (expo-router builds on these; should work if expo-router shim works)
- `bluesky-ozone`, `@/axiom-crash-reporter`, `@/bluesky-api`, `@/libretranslate-api`, `@/tenor-api`, `@/tmdb-api` (akari internal packages — bundle via the same `npm install` chain)
- `hls.js` — web-only; akari guards behind `.web.tsx` so the Linux path doesn't load it
- `i18n-js`, `react-intl`, `pseudo-localization`
- `@formatjs/*` polyfills

## Path to first boot

The minimum to bundle + render a blank screen:

1. **All the small shims above** — without them, `import` fails at bundle time
2. **Stub the deal-breakers** — `react-native-webview`, `react-native-webrtc`, `@sentry/react-native`, `@shopify/flash-list` as throw-on-use proxies. App boots; any screen using them blows up loudly
3. **Verify the expo-router shim** handles `(auth)` / `(tabs)` route groups + nested layouts
4. **`react-native-svg` + `lucide-react-native`** — without these, every icon throws

Optimistic total: **2-3 days of focused shim work** before the bundle
produces a non-crashing first render. Several more weeks before the
chat / feed surfaces are actually usable (depend on video + gesture
handler + worklets being real).

## Path to "akari is daily-driver"

After first boot:

1. **`expo-video` / `react-native-video`** — without this, every post
   with a video is broken. `GtkMediaFile` does most of the heavy
   lifting; the gap is the Fabric component + JS API surface
2. **`react-native-gesture-handler`** real implementation — without
   this, swipe-to-navigate and pinch-to-zoom-image don't work
3. **`react-native-reanimated` v4 + `react-native-worklets`** verified
   against akari's screens. Likely "worklets run on main JS thread"
   compromise
4. **`@shopify/flash-list`** real virtualization — without it, scroll
   perf on long feeds tanks
5. **`react-native-webview`** for in-app OAuth flow + external link
   previews. Could defer by sending OAuth out to the system browser
   via the existing `expo-web-browser` shim
6. **`react-native-webrtc`** for the StreamPlace voice/video features.
   Probably out of scope until libwebrtc availability is sorted

## Updating this doc

When a shim lands, update the relevant row's status here in the same
commit. Akari's actual `package.json` is the ground truth for the dep
list — re-run the audit script at `scripts/audit-akari-deps.sh` (TODO)
to catch new dependencies as akari evolves.
