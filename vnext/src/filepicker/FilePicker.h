#pragma once

// Shared GtkFileDialog backend for `expo-document-picker` and
// `expo-image-picker`. GTK 4.10+ ships GtkFileDialog (replacing
// the deprecated GtkFileChooserDialog) — same async open-then-
// callback model, simpler API.
//
// One C++ entry point handles both modules; the JS shims layer
// their respective semantics (MIME filters, "library vs camera"
// dispatch) on top.

#include <functional>
#include <string>
#include <vector>

typedef struct _GtkWidget GtkWidget;

namespace rnlinux::filepicker {

struct PickedFile {
  std::string path;     // absolute filesystem path
  std::string name;     // basename
  int64_t size = 0;     // bytes (best-effort via stat)
  std::string mimeType; // best-effort guess via gio
  // Image-only — populated via gdk_pixbuf_get_file_info, which
  // reads only the header (no decode). Zero for non-images or
  // unsupported formats.
  int32_t width = 0;
  int32_t height = 0;
  // Video-only — populated via GstDiscoverer, which parses the
  // container/codec metadata without decoding frames. Duration is
  // in milliseconds; width/height come from the first video
  // stream. Zero for non-videos or formats GStreamer can't parse.
  int64_t durationMs = 0;
};

struct PickOptions {
  std::string title;                    // dialog title
  std::vector<std::string> mimeFilters; // e.g. {"image/*"} or {"text/plain", "application/pdf"}
  bool multiple = false;                // single vs multiple selection
};

using OnPicked = std::function<void(const std::vector<PickedFile>&)>;
using OnCanceled = std::function<void()>;
using OnError = std::function<void(const std::string&)>;

// Open a file-chooser dialog parented to `parent` (the app's
// root window). Returns immediately; the callback fires once on
// the main loop when the user closes the dialog. Cancellation
// fires `onCanceled` (NOT `onError`) so the JS shim can map it
// to `{canceled: true}` as upstream's contract requires.
void pickFiles(GtkWidget* parent,
               const PickOptions& opts,
               OnPicked onPicked,
               OnCanceled onCanceled,
               OnError onError);

} // namespace rnlinux::filepicker
