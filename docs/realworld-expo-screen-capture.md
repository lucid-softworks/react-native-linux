# Real-app harness: expo-screen-capture (honest Linux no-op)

`expo-screen-capture`'s job upstream is to:

1. **Prevent** the OS from capturing the app's window
   (iOS "secure window", Android FLAG_SECURE).
2. **Detect** when the user takes a screenshot.

Neither concept maps cleanly to Linux, so this shim is an honest
no-op rather than a fake-success implementation.

## Why a no-op

**Prevention:** there's no portable "secure window" hint across
the Linux compositor landscape:

- **X11** has no such mechanism. Any process with access to the
  display can grab the framebuffer via `XGetImage`.
- **Wayland** has the `wp-security-context-v1` protocol, but
  it's compositor-specific (GNOME's mutter implements parts of
  it for Flatpak sandboxes; Sway and many others don't). Even
  where supported, it doesn't reliably block screen-recording
  tools that route through PipeWire.
- Tools that grab screens (gnome-screenshot, ffmpeg, OBS,
  xdg-desktop-portal ScreenCast) will succeed regardless of
  what we set on our window.

**Detection:** no portable signal exists. Each screenshot tool
acts independently — there's no DBus event when `import`, `grim`,
PrintScreen, or `gnome-screenshot` fires.

Returning fake "true" / a working subscription that never fires
would let consumers believe their secrets are protected. The
honest move is to expose the API surface (so cross-platform code
compiles) but document the non-enforcement clearly.

## Architecture

```
JS app
  ↓ require('expo-screen-capture')
@lucid-softworks/.../expo-screen-capture.js
  ├─ preventScreenCaptureAsync / allowScreenCaptureAsync
  │    → flips an internal flag (so usePreventScreenCapture's
  │      mount/unmount pairs stay symmetric) but does nothing
  │      visible to the OS.
  ├─ usePreventScreenCapture hook   → no-op
  ├─ addScreenshotListener          → no-op subscription
  └─ isAvailableAsync()             → true (API works; effects don't)
```

No native code; no DBus.

## API surface

| API                           | Behavior on Linux                                  |
| ----------------------------- | -------------------------------------------------- |
| `preventScreenCaptureAsync()` | No-op — sets an internal flag for bookkeeping only |
| `allowScreenCaptureAsync()`   | No-op — clears the internal flag                   |
| `usePreventScreenCapture()`   | No-op hook                                         |
| `isAvailableAsync()`          | Returns `true` — API surface is wired              |
| `addScreenshotListener`       | Returns no-op `{remove()}` subscription            |

## When this might become real

- **Flatpak / Snap sandboxes** can enforce some prevention via
  xdg-desktop-portal — adding the portal check + opt-out plumbing
  would give partial prevention inside sandboxes.
- **Wayland-only deployments** on compositors that implement
  `wp-security-context-v1` could wire the protocol when the
  surface exposes it.
- **Per-distro screenshot tools** (gnome-screenshot, KDE's
  Spectacle, etc.) each emit DBus signals on their own
  interfaces — a polling watcher could listen for all known ones,
  but it's brittle and never universally complete.

None of those land "real screen-capture protection" — they each
narrow the gap. Apps with genuine secrecy needs should display
sensitive data through a non-capturable channel (terminal, audio
prompt) or accept that desktop screen capture is fundamentally
user-controlled.
