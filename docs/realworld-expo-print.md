# Real-app harness: expo-print via GtkPrintOperation + Pango

`expo-print` is backed by GtkPrintOperation for the print-dialog
path and a cairo PDF surface for `printToFileAsync`. Both render
the same way: lay the text out with Pango (word-wrapped at the
page width minus margins, paginated by line height), then draw
each page through the cairo context the operation hands us.

## Architecture

```
JS app
  ↓ require('expo-print')
@lucid-softworks/.../expo-print.js
  ├─ html → plaintext (regex tag-strip + entity decode)
  ├─ printAsync({html})     → rnLinux.printText
  └─ printToFileAsync({html}) → rnLinux.printExportPdf
  ↓
vnext/src/jsi/RnLinuxBindings.cpp
  ↓
vnext/src/print/Print.cpp
  ├─ buildLayout(cairo_t, text, pageWidth, margin)
  │    → PangoLayout (Sans 11pt, word+char wrap)
  ├─ layoutForPage(layout, pageHeight, margin)
  │    → pageLineRanges[] (paginated by line extents)
  ├─ renderPage(cr, layout, pageIdx)
  │    → pango_cairo_show_layout_line per line
  │
  ├─ printText:  gtk_print_operation_run(PRINT_DIALOG)
  │              → user picks printer / Save as PDF / cancel
  └─ exportToPdf: cairo_pdf_surface_create + show_page loop
                  (synchronous, no dialog)
```

## VM / host setup

Nothing. GTK + Pango + cairo are already linked for everything else.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The expo-print section has two buttons:

- **render to PDF** — calls `printToFileAsync` and shows the
  resulting `file://…/print-…pdf` path.
- **open print dialog** — calls `printAsync`, which pops the
  standard GtkPrintDialog (printer list, page setup, "Save as
  PDF" target). The probe at the top of the section also writes
  a tiny PDF and re-reads its size via expo-file-system to
  confirm the round-trip end-to-end.

## API surface

| API                             | Behavior on Linux                                                        |
| ------------------------------- | ------------------------------------------------------------------------ |
| `printAsync({html})`            | Real — strips HTML, renders via Pango, opens GtkPrintOperation dialog    |
| `printAsync({uri})`             | Real — fetches the URI (file://, http(s)://, data:) then prints as HTML  |
| `printToFileAsync({html, ...})` | Real — writes a cairo-PDF; result has real `numberOfPages` from Pango    |
| `printToFileAsync({uri})`       | Real — fetches the URI then writes a cairo-PDF                           |
| `selectPrinterAsync()`          | Throws — iOS-only (system print dialog handles selection inline)         |
| `Orientation` enum              | Accepted, discarded — the print dialog lets the user pick                |
| `options.width / height`        | Accepted, discarded — A4 by default; the print dialog handles paper size |

## Known gaps

- **No HTML rendering.** Anything beyond the simplest tags + a
  couple of entities gets stripped. A real renderer means
  embedding WebKitGTK (~50 MB on disk, GtkWidget-based, real
  font/image/CSS support); the natural follow-up if any real app
  has print fidelity needs.
- **`printAsync({uri})`** — **DONE for HTML / plaintext payloads.**
  The shim fetches `file://` via `fsReadString`, `http(s)://` via
  `fsDownload` + read, and `data:` URIs by decoding inline, then
  feeds the content through the same HTML-to-text path as
  `{html}`. Printing an existing PDF / image file (where the
  fetched bytes are not HTML) still won't render correctly — that
  needs poppler-glib for PDFs and gdk-pixbuf onto the cairo
  context for images, which is the natural follow-up.
- **`base64` in `printToFileAsync` result** — **DONE.** Opt-in via
  `options.base64 = true` (off by default since it doubles the
  per-call cost). When enabled, the shim reads the just-written
  PDF back through `fsReadString(path, 'base64')` and attaches
  the encoded string to the resolved object.
- **Font / margin / orientation customization** — **DONE.** The
  Pango layout pipeline now honors:
  - `options.fontFamily` (string, default "Sans")
  - `options.fontSize` (points, default 11)
  - `options.margin` (uniform, in points) OR `options.margins`
    object collapsed to its max value (default 50)
  - `options.orientation === 'landscape'` to swap the cairo PDF
    page dimensions and pre-set the print dialog's orientation
    Pango treats all four margins equally for plain text, so the
    `margins.{left,right,top,bottom}` object form is collapsed to
    the largest specified value. Asymmetric margins would need a
    richer renderer (WebKitGTK).
- **`numberOfPages` in the printToFileAsync result** — **DONE.**
  Pango's pagination result is threaded back through the JSI
  callback so the resolved promise's `numberOfPages` is the real
  count (clamped to `>= 1`).
