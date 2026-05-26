# Real-app harness: expo-clipboard via GdkClipboard

`expo-clipboard` for text is a thin wrapper over the existing
`rnLinux.clipboard*` JSI bindings (added during the device-info
work). Those talk to `GdkClipboard` on the active display — the
same surface every GTK app uses. Cross-app paste works because
the display clipboard is shared with the rest of the desktop.

## Architecture

```
JS app
  ↓ require('expo-clipboard')    ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-clipboard.js
  ├─ setStringAsync(text)        →  rnLinux.clipboardSetString
  │                                    ↓ gdk_clipboard_set_text
  │                                    GdkClipboard on display
  └─ getStringAsync() / hasStringAsync()
                                 →  rnLinux.clipboardGetStringSync
                                      ↓ gdk_clipboard_get_content
                                      → GdkContentProvider value
```

## VM / host setup

None. GTK4 is already a runtime dep; `GdkClipboard` is bundled.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

Scroll to the `expo-clipboard` section. The probe row already shows
a successful set+get round-trip (`roundtripped 22 chars`). The demo
exposes two buttons: **copy timestamp** writes a fresh ISO timestamp
to the clipboard; **paste** reads back whatever's on the clipboard
and displays it inline.

## API surface

| API                                                  | Behavior on Linux                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `setStringAsync(text)` / `setString`                 | Real — `gdk_clipboard_set_text` on the display                           |
| `getStringAsync()`                                   | Real for values WE wrote (sync read of `gdk_clipboard_get_content`)      |
| `hasStringAsync()`                                   | True iff `getStringAsync()` returns a non-empty string                   |
| `getUrlAsync` / `setUrlAsync` / `hasUrl…`            | Aliases for the text path — no separate Linux URL clip type              |
| `getImageAsync` / `setImageAsync`                    | Throws — base64-PNG round-trip not wired yet                             |
| `getHtmlAsync` / `setHtmlAsync`                      | Throws — HTML+plaintext fallback not wired yet                           |
| `hasImageAsync` / `hasHtmlAsync`                     | Returns `false`                                                          |
| `addClipboardListener`                               | Returns a no-op subscription (GdkClipboard's `changed` signal not bound) |
| `ContentType` / `StringFormat` / `ImageFormat` enums | Match upstream's numeric values                                          |

## Known gaps

- **Cross-app paste reads** — **DONE.** `getStringAsync` /
  `hasStringAsync` now route through
  `rnLinux.clipboardGetStringAsync` →
  `gdk_clipboard_read_text_async`, which negotiates the MIME
  transfer with whichever app put the text on the clipboard. The
  legacy sync `clipboardGetStringSync` is still there for the
  fast in-process round-trip but only sees this process's own
  writes.
- **Images** (`getImageAsync` / `setImageAsync`) would round-trip
  base64 PNG through `GdkTexture` + `gdk_clipboard_set_texture`,
  same path the camera snap demo uses. Not bound yet.
- **HTML** is the same shape — `gdk_content_provider_new_union` of
  text + text/html. The expo API expects both formats present
  simultaneously.
- **File lists** (`Clipboard.setContentAsync({files: [...]})`) need
  `gdk_clipboard_set_content` of a `G_FILE_LIST` provider. Less
  commonly used than text but trivial to add.
- **Change listener** wants `g_signal_connect(clip, "changed", ...)`.
  Easy if there's demand; today the no-op subscription means apps
  polling for clipboard updates won't crash but also won't fire.
