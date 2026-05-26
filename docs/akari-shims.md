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

Last attempted: 2026-05-26. Bundle fails at first unresolved import.
Static audit (this doc) is the source of truth until a real bundle
attempt lands an end-to-end boot.

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
