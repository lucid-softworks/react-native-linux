#pragma once

// `expo-print` backend. GtkPrintOperation handles the dialog +
// spooler integration; Pango lays the page out. HTML input
// gets stripped to plaintext (a real HTML renderer would mean
// WebKitGTK, which we're not pulling in — see the doc's gaps).
//
// Two entry points:
//   * printText      — opens the system print dialog with the
//                      text rendered onto one or more pages.
//   * exportToPdf    — same rendering, but writes a PDF to a
//                      caller-provided path instead of prompting.

#include <functional>
#include <string>

typedef struct _GtkWidget GtkWidget;

namespace rnlinux::print {

using OnDone = std::function<void()>;
using OnPdfDone = std::function<void(int pageCount)>;
using OnError = std::function<void(const std::string&)>;

// Layout options threaded into the Pango pipeline. Defaults match
// the previous hardcoded values (Sans 11pt, 50pt margins, A4
// portrait); callers override via the corresponding expo-print
// `options.*` keys.
struct LayoutOptions {
  std::string fontFamily = "Sans";
  int fontPointSize = 11;
  double marginPts = 50.0;
  bool landscape = false;
};

// Show the print dialog. Returns immediately; callbacks fire on
// the main loop after the user prints or cancels (cancel is
// treated as success in expo's API).
void printText(GtkWidget* parent,
               const std::string& text,
               const LayoutOptions& layout,
               OnDone onDone,
               OnError onError);

// Render to a PDF file. Same Pango layout pipeline as printText,
// but the output is a cairo PDF surface instead of a print
// context. onDone fires with the page count Pango paginated into
// so the JS shim can surface it as expo-print's `numberOfPages`.
void exportToPdf(const std::string& text,
                 const std::string& outPath,
                 const LayoutOptions& layout,
                 OnPdfDone onDone,
                 OnError onError);

} // namespace rnlinux::print
