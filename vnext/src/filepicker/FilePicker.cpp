#include "FilePicker.h"

#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <sys/stat.h>

namespace rnlinux::filepicker {

namespace {

struct PickCtx {
  OnPicked onPicked;
  OnCanceled onCanceled;
  OnError onError;
  bool multiple = false;
};

PickedFile gfileToPickedFile(GFile* gfile) {
  PickedFile pf;
  if (!gfile)
    return pf;
  gchar* path = g_file_get_path(gfile);
  if (path) {
    pf.path = path;
    g_free(path);
  }
  gchar* basename = g_file_get_basename(gfile);
  if (basename) {
    pf.name = basename;
    g_free(basename);
  }
  if (!pf.path.empty()) {
    struct stat st {};
    if (stat(pf.path.c_str(), &st) == 0) {
      pf.size = static_cast<int64_t>(st.st_size);
    }
  }
  // Best-effort MIME guess via gio's content-type machinery.
  GError* err = nullptr;
  GFileInfo* info =
      g_file_query_info(gfile, "standard::content-type", G_FILE_QUERY_INFO_NONE, nullptr, &err);
  if (info) {
    const char* ct = g_file_info_get_content_type(info);
    if (ct) {
      gchar* mime = g_content_type_get_mime_type(ct);
      if (mime) {
        pf.mimeType = mime;
        g_free(mime);
      }
    }
    g_object_unref(info);
  }
  if (err)
    g_error_free(err);
  return pf;
}

// Single-file open callback.
void onOpenFinish(GObject* source, GAsyncResult* result, gpointer userData) {
  auto* ctx = static_cast<PickCtx*>(userData);
  GError* err = nullptr;
  GFile* file = gtk_file_dialog_open_finish(GTK_FILE_DIALOG(source), result, &err);
  if (!file) {
    // GTK_DIALOG_ERROR_DISMISSED means the user cancelled — that's
    // not a real error in our contract, it's the "canceled: true"
    // branch JS callers expect.
    if (err && err->domain == GTK_DIALOG_ERROR && err->code == GTK_DIALOG_ERROR_DISMISSED) {
      if (ctx->onCanceled)
        ctx->onCanceled();
    } else if (ctx->onError) {
      ctx->onError(err && err->message ? err->message : "file open failed");
    }
    if (err)
      g_error_free(err);
    delete ctx;
    return;
  }
  std::vector<PickedFile> out;
  out.push_back(gfileToPickedFile(file));
  g_object_unref(file);
  if (ctx->onPicked)
    ctx->onPicked(out);
  delete ctx;
}

// Multi-file open callback.
void onOpenMultipleFinish(GObject* source, GAsyncResult* result, gpointer userData) {
  auto* ctx = static_cast<PickCtx*>(userData);
  GError* err = nullptr;
  GListModel* list = gtk_file_dialog_open_multiple_finish(GTK_FILE_DIALOG(source), result, &err);
  if (!list) {
    if (err && err->domain == GTK_DIALOG_ERROR && err->code == GTK_DIALOG_ERROR_DISMISSED) {
      if (ctx->onCanceled)
        ctx->onCanceled();
    } else if (ctx->onError) {
      ctx->onError(err && err->message ? err->message : "file open failed");
    }
    if (err)
      g_error_free(err);
    delete ctx;
    return;
  }
  std::vector<PickedFile> out;
  const guint n = g_list_model_get_n_items(list);
  for (guint i = 0; i < n; ++i) {
    GFile* file = static_cast<GFile*>(g_list_model_get_item(list, i));
    if (file) {
      out.push_back(gfileToPickedFile(file));
      g_object_unref(file);
    }
  }
  g_object_unref(list);
  if (ctx->onPicked)
    ctx->onPicked(out);
  delete ctx;
}

GListStore* buildFilters(const std::vector<std::string>& mimeFilters) {
  if (mimeFilters.empty())
    return nullptr;
  GListStore* store = g_list_store_new(GTK_TYPE_FILE_FILTER);
  // One combined filter — users see "Allowed types" as the
  // single dropdown entry rather than per-MIME options. Matches
  // the upstream picker UX more closely than per-type sub-
  // filters.
  GtkFileFilter* filter = gtk_file_filter_new();
  gtk_file_filter_set_name(filter, "Allowed types");
  for (const auto& mime : mimeFilters) {
    // Glob "image/*" → expand into per-suffix GtkFileFilter
    // patterns AND add the literal mime so the chooser respects
    // it for systems with content-type detection.
    if (mime.size() >= 2 && mime.substr(mime.size() - 2) == "/*") {
      const auto top = mime.substr(0, mime.size() - 2);
      // GtkFileFilter doesn't expand mime wildcards; add the
      // bare top-level (gtk will match content-type prefix) plus
      // common globs so name-based matching also works.
      gtk_file_filter_add_mime_type(filter, mime.c_str());
      if (top == "image") {
        for (const char* g :
             {"*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.bmp", "*.svg", "*.tiff", "*.heic"})
          gtk_file_filter_add_pattern(filter, g);
      } else if (top == "video") {
        for (const char* g : {"*.mp4", "*.webm", "*.mov", "*.mkv", "*.avi", "*.m4v"})
          gtk_file_filter_add_pattern(filter, g);
      } else if (top == "audio") {
        for (const char* g : {"*.mp3", "*.wav", "*.ogg", "*.flac", "*.m4a", "*.opus"})
          gtk_file_filter_add_pattern(filter, g);
      }
    } else {
      gtk_file_filter_add_mime_type(filter, mime.c_str());
    }
  }
  g_list_store_append(store, filter);
  g_object_unref(filter);
  return store;
}

} // namespace

void pickFiles(GtkWidget* parent,
               const PickOptions& opts,
               OnPicked onPicked,
               OnCanceled onCanceled,
               OnError onError) {
  if (!parent) {
    if (onError)
      onError("file picker: no parent window");
    return;
  }
  GtkFileDialog* dialog = gtk_file_dialog_new();
  if (!dialog) {
    if (onError)
      onError("file picker: gtk_file_dialog_new returned null");
    return;
  }
  gtk_file_dialog_set_modal(dialog, TRUE);
  if (!opts.title.empty())
    gtk_file_dialog_set_title(dialog, opts.title.c_str());
  if (GListStore* filters = buildFilters(opts.mimeFilters); filters) {
    gtk_file_dialog_set_filters(dialog, G_LIST_MODEL(filters));
    g_object_unref(filters);
  }
  // GtkFileDialog expects a GtkWindow parent. Walk up from
  // whatever widget we got handed — that's the root view, which
  // is parented inside our GtkApplicationWindow.
  GtkRoot* root = gtk_widget_get_root(parent);
  GtkWindow* win = GTK_IS_WINDOW(root) ? GTK_WINDOW(root) : nullptr;
  auto* ctx =
      new PickCtx{std::move(onPicked), std::move(onCanceled), std::move(onError), opts.multiple};
  if (opts.multiple) {
    gtk_file_dialog_open_multiple(dialog, win, /*cancellable=*/nullptr, onOpenMultipleFinish, ctx);
  } else {
    gtk_file_dialog_open(dialog, win, /*cancellable=*/nullptr, onOpenFinish, ctx);
  }
  // The dialog keeps itself alive through the async hop; we can
  // drop our ref now.
  g_object_unref(dialog);
}

} // namespace rnlinux::filepicker
