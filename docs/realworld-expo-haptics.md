# Real-app harness: expo-haptics via gdk_display_beep

`expo-haptics` is shimmed to `gdk_display_beep` on the default
display. Desktop hardware has no haptics motor; the WM / sound
theme decides whether the beep produces a sound, a title-bar
flash, or nothing. On a Lima dev VM with no audio sink the bell is
effectively silent — but the API still fires successfully so
cross-platform code that calls `Haptics.impactAsync()` doesn't
throw.

## Architecture

```
JS app
  ↓ require('expo-haptics')   ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-haptics.js
  ├─ impactAsync / notificationAsync / selectionAsync / etc.
  │    → rnLinux.haptic()
  ↓
vnext/src/jsi/RnLinuxBindings.cpp
  └─ gdk_display_beep(gdk_display_get_default())
```

All impact styles (Light / Medium / Heavy / Soft / Rigid) and
notification types (Success / Warning / Error) route through the
same beep. The iOS Taptic Engine distinction between styles has no
GTK equivalent — we could synthesize multi-beep patterns but most
freedesktop bell consumers expect a single chime, and varying
beep counts per call produces an annoying UX rather than a useful
signal.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The expo-haptics section has buttons for the four most-common
calls; clicking any fires `gdk_display_beep` and updates the
`last:` line.

## API surface

| API                                                                         | Behavior on Linux                    |
| --------------------------------------------------------------------------- | ------------------------------------ |
| `impactAsync(ImpactFeedbackStyle.*)`                                        | `gdk_display_beep`                   |
| `notificationAsync(NotificationFeedbackType.*)`                             | `gdk_display_beep`                   |
| `selectionAsync()`                                                          | `gdk_display_beep`                   |
| `performAndroidHapticsAsync(AndroidHaptics.*)`                              | `gdk_display_beep`                   |
| `ImpactFeedbackStyle` / `NotificationFeedbackType` / `AndroidHaptics` enums | Match upstream string/numeric values |

## Known gaps

- **No real haptics on desktop.** Hardware (USB game controllers,
  haptic mice, some laptop trackpads) exposes per-device rumble
  via libinput or evdev, but there's no portable "tactile
  feedback" surface. Apps that genuinely need rumble would target
  the specific device via SDL2 or hidraw.
- **No per-style differentiation.** Light vs Heavy collapse to the
  same beep. If real apps depend on the distinction, a richer
  binding could play different sound assets, but that's a larger
  audio-pipeline question (which we don't have wired into the
  runtime yet).
- **`gdk_display_beep` is silent in headless Lima.** No audio
  device exists, so the bell can't be heard. The API call itself
  completes successfully.
