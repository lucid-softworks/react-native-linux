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

| API                                                  | Behavior on Linux                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `setStringAsync(text)` / `setString`                 | Real — `gdk_clipboard_set_text` on the display                                       |
| `getStringAsync()`                                   | Real for values WE wrote (sync read of `gdk_clipboard_get_content`)                  |
| `hasStringAsync()`                                   | True iff `getStringAsync()` returns a non-empty string                               |
| `getUrlAsync` / `setUrlAsync` / `hasUrl…`            | Aliases for the text path — no separate Linux URL clip type                          |
| `getImageAsync` / `setImageAsync`                    | Real — base64 PNG/JPEG round-trip through `GdkTexture` + `gdk_clipboard_set_texture` |
| `getHtmlAsync` / `setHtmlAsync`                      | Real — unioned `text/html` + `text/plain` provider; plaintext extracted in JS        |
| `hasImageAsync` / `hasHtmlAsync`                     | Real — non-empty result from the matching async getter                               |
| `setContentAsync({files: [...]})`                    | Real — `GdkFileList` content provider; file managers paste real file refs            |
| `addClipboardListener`                               | Real — fan-out over `GdkClipboard::changed` (cross-app writes fire it too)           |
| `ContentType` / `StringFormat` / `ImageFormat` enums | Match upstream's numeric values                                                      |

## Known gaps

- **Cross-app paste reads** — **DONE.** `getStringAsync` /
  `hasStringAsync` now route through
  `rnLinux.clipboardGetStringAsync` →
  `gdk_clipboard_read_text_async`, which negotiates the MIME
  transfer with whichever app put the text on the clipboard. The
  legacy sync `clipboardGetStringSync` is still there for the
  fast in-process round-trip but only sees this process's own
  writes.
- **Images** — **DONE.** `setImageAsync(base64)` decodes via
  `gdk_texture_new_from_bytes` and calls `gdk_clipboard_set_texture`;
  `getImageAsync()` reads through `gdk_clipboard_read_texture_async`
  and re-encodes as PNG via `gdk_texture_save_to_png_bytes` so the
  base64 payload is self-describing.
- **HTML** — **DONE.** `setHtmlAsync(html)` publishes a
  `gdk_content_provider_new_union` over both `text/html` and
  `text/plain;charset=utf-8` (plaintext extracted in JS) so
  non-rich consumers still get something readable.
  `getHtmlAsync()` asks for `text/html` specifically via
  `gdk_clipboard_read_async` and drains the returned
  `GInputStream`.
- **File lists** — **DONE.** `Clipboard.setContentAsync({files:
[...]})` builds a `GdkFileList` (`gdk_file_list_new_from_list`)
  and publishes a typed `GDK_TYPE_FILE_LIST` content provider;
  file managers paste real file refs, not just text URIs.
- **Change listener** — **DONE.** `g_signal_connect(clip,
"changed", ...)` is bound through a single native trampoline;
  the JS shim multiplexes all `addClipboardListener` subscribers
  behind it and tears the subscription down when the last
  listener unsubscribes. The signal fires on every clipboard
  write — including ones from other apps — so this is a real
  cross-app subscription, not a same-process echo. The payload
  is `{}` (iOS/Android pass content-type metadata; we don't
  carry that without an extra async read) — consumers re-call
  `getStringAsync()` to fetch the new value, matching the expo
  idiom.
