#include "Print.h"

#include "react-native-linux/Logging.h"

#include <cairo-pdf.h>
#include <cairo.h>
#include <gtk/gtk.h>
#include <pango/pangocairo.h>
#include <vector>

namespace rnlinux::print {

namespace {

constexpr double kPdfPageWidth = 595.0; // A4 in pts (1pt = 1/72")
constexpr double kPdfPageHeight = 842.0;

// Lay out the text into a Pango layout sized for the printable
// area (page minus margins). Returns the number of pages the
// text needs once paginated.
struct LayoutResult {
  int pageCount = 1;
  // Per-page lines [start, end) — Pango layout-line indices.
  std::vector<std::pair<int, int>> pageLineRanges;
};

LayoutResult layoutForPage(PangoLayout* layout, double pageHeight, double margin) {
  LayoutResult r;
  const double usableHeight = pageHeight - 2 * margin;
  const int total = pango_layout_get_line_count(layout);
  if (total == 0) {
    r.pageLineRanges.push_back({0, 0});
    return r;
  }
  int lineIdx = 0;
  double y = 0;
  int start = 0;
  for (; lineIdx < total; ++lineIdx) {
    PangoLayoutLine* line = pango_layout_get_line_readonly(layout, lineIdx);
    PangoRectangle ink, logical;
    pango_layout_line_get_extents(line, &ink, &logical);
    double lineH = static_cast<double>(logical.height) / PANGO_SCALE;
    if (y + lineH > usableHeight && lineIdx > start) {
      r.pageLineRanges.push_back({start, lineIdx});
      start = lineIdx;
      y = 0;
    }
    y += lineH;
  }
  r.pageLineRanges.push_back({start, total});
  r.pageCount = static_cast<int>(r.pageLineRanges.size());
  return r;
}

void renderPage(
    cairo_t* cr, PangoLayout* layout, const LayoutResult& lay, int pageIndex, double margin) {
  if (pageIndex < 0 || pageIndex >= lay.pageCount)
    return;
  const auto [start, end] = lay.pageLineRanges[pageIndex];
  cairo_save(cr);
  cairo_translate(cr, margin, margin);
  // Walk lines start..end, rendering each at the right y offset.
  double y = 0;
  for (int i = start; i < end; ++i) {
    PangoLayoutLine* line = pango_layout_get_line_readonly(layout, i);
    PangoRectangle ink, logical;
    pango_layout_line_get_extents(line, &ink, &logical);
    const double baseline =
        static_cast<double>(pango_layout_get_baseline(layout) +
                            (logical.y / PANGO_SCALE - logical.y / PANGO_SCALE)) /
        PANGO_SCALE;
    (void)baseline;
    cairo_move_to(cr, 0, y);
    pango_cairo_show_layout_line(cr, line);
    y += static_cast<double>(logical.height) / PANGO_SCALE;
  }
  cairo_restore(cr);
}

// Build a fresh PangoLayout sized for the printable area, with
// the supplied text laid out and word-wrapped.
PangoLayout*
buildLayout(cairo_t* cr, const std::string& text, double pageWidth, const LayoutOptions& opts) {
  PangoLayout* layout = pango_cairo_create_layout(cr);
  PangoFontDescription* font = pango_font_description_from_string(opts.fontFamily.c_str());
  pango_font_description_set_size(font, opts.fontPointSize * PANGO_SCALE);
  pango_layout_set_font_description(layout, font);
  pango_font_description_free(font);
  pango_layout_set_width(layout, static_cast<int>((pageWidth - 2 * opts.marginPts) * PANGO_SCALE));
  pango_layout_set_wrap(layout, PANGO_WRAP_WORD_CHAR);
  pango_layout_set_text(layout, text.c_str(), -1);
  return layout;
}

struct PrintCtx {
  std::string text;
  LayoutOptions layoutOpts;
  LayoutResult layoutResult;
  PangoLayout* layout = nullptr; // owned by the cairo context for the print op
  OnDone onDone;
  OnError onError;
};

void onBeginPrint(GtkPrintOperation* op, GtkPrintContext* context, gpointer userData) {
  auto* ctx = static_cast<PrintCtx*>(userData);
  cairo_t* cr = gtk_print_context_get_cairo_context(context);
  // Real page dimensions from GtkPrintContext — we asked GTK for
  // A4 by default but the user's printer settings can override.
  const double w = gtk_print_context_get_width(context);
  const double h = gtk_print_context_get_height(context);
  ctx->layout = buildLayout(cr, ctx->text, w, ctx->layoutOpts);
  ctx->layoutResult = layoutForPage(ctx->layout, h, ctx->layoutOpts.marginPts);
  gtk_print_operation_set_n_pages(op, ctx->layoutResult.pageCount);
}

void onDrawPage(GtkPrintOperation* /*op*/,
                GtkPrintContext* context,
                gint pageIndex,
                gpointer userData) {
  auto* ctx = static_cast<PrintCtx*>(userData);
  cairo_t* cr = gtk_print_context_get_cairo_context(context);
  if (!ctx->layout)
    return;
  renderPage(cr, ctx->layout, ctx->layoutResult, pageIndex, ctx->layoutOpts.marginPts);
}

void onEndPrint(GtkPrintOperation* /*op*/, GtkPrintContext* /*context*/, gpointer userData) {
  auto* ctx = static_cast<PrintCtx*>(userData);
  if (ctx->layout) {
    g_object_unref(ctx->layout);
    ctx->layout = nullptr;
  }
}

void onDone(GtkPrintOperation* /*op*/, GtkPrintOperationResult result, gpointer userData) {
  auto* ctx = static_cast<PrintCtx*>(userData);
  if (result == GTK_PRINT_OPERATION_RESULT_ERROR) {
    if (ctx->onError)
      ctx->onError("print operation reported an error");
  } else {
    if (ctx->onDone)
      ctx->onDone();
  }
  delete ctx;
}

} // namespace

void printText(GtkWidget* parent,
               const std::string& text,
               const LayoutOptions& layout,
               OnDone onDoneCb,
               OnError onErrorCb) {
  if (!parent) {
    if (onErrorCb)
      onErrorCb("print: no parent window");
    return;
  }
  GtkPrintOperation* op = gtk_print_operation_new();
  if (!op) {
    if (onErrorCb)
      onErrorCb("print: gtk_print_operation_new failed");
    return;
  }
  // Apply orientation up front; GtkPrintOperation keeps the
  // current settings around and threads them into the dialog so
  // the user sees the orientation we asked for as the default.
  GtkPrintSettings* settings = gtk_print_settings_new();
  gtk_print_settings_set_orientation(
      settings, layout.landscape ? GTK_PAGE_ORIENTATION_LANDSCAPE : GTK_PAGE_ORIENTATION_PORTRAIT);
  gtk_print_operation_set_print_settings(op, settings);
  g_object_unref(settings);
  auto* ctx = new PrintCtx{text, layout, {}, nullptr, std::move(onDoneCb), std::move(onErrorCb)};
  g_signal_connect(op, "begin-print", G_CALLBACK(onBeginPrint), ctx);
  g_signal_connect(op, "draw-page", G_CALLBACK(onDrawPage), ctx);
  g_signal_connect(op, "end-print", G_CALLBACK(onEndPrint), ctx);
  g_signal_connect(op, "done", G_CALLBACK(onDone), ctx);
  GtkRoot* root = gtk_widget_get_root(parent);
  GtkWindow* win = GTK_IS_WINDOW(root) ? GTK_WINDOW(root) : nullptr;
  GError* err = nullptr;
  gtk_print_operation_run(op, GTK_PRINT_OPERATION_ACTION_PRINT_DIALOG, win, &err);
  if (err) {
    RNL_LOGW("rnLinux.print") << "run failed: " << err->message;
    g_error_free(err);
  }
  g_object_unref(op);
}

void exportToPdf(const std::string& text,
                 const std::string& outPath,
                 const LayoutOptions& layout,
                 OnPdfDone onDoneCb,
                 OnError onErrorCb) {
  // Swap dimensions for landscape — cairo PDFs don't carry an
  // orientation tag separately, so we rotate the page itself.
  const double pageWidth = layout.landscape ? kPdfPageHeight : kPdfPageWidth;
  const double pageHeight = layout.landscape ? kPdfPageWidth : kPdfPageHeight;
  cairo_surface_t* surface = cairo_pdf_surface_create(outPath.c_str(), pageWidth, pageHeight);
  if (!surface || cairo_surface_status(surface) != CAIRO_STATUS_SUCCESS) {
    if (surface)
      cairo_surface_destroy(surface);
    if (onErrorCb)
      onErrorCb("print: cairo_pdf_surface_create failed");
    return;
  }
  cairo_t* cr = cairo_create(surface);
  PangoLayout* pl = buildLayout(cr, text, pageWidth, layout);
  LayoutResult lay = layoutForPage(pl, pageHeight, layout.marginPts);
  for (int p = 0; p < lay.pageCount; ++p) {
    renderPage(cr, pl, lay, p, layout.marginPts);
    cairo_show_page(cr);
  }
  g_object_unref(pl);
  cairo_destroy(cr);
  cairo_surface_finish(surface);
  cairo_surface_destroy(surface);
  if (onDoneCb)
    onDoneCb(lay.pageCount);
}

} // namespace rnlinux::print
