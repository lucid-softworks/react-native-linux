#include "react-native-linux/RNLinuxApplication.h"
#include "react-native-linux/CrashHandler.h"
#include "react-native-linux/Logging.h"

#include "fabric/LinuxMountingManager.h"
#include "jsi/RnLinuxBindings.h"

#include <gio/gio.h>
#include <gtk/gtk.h>

#include <cstring>
#include <memory>
#include <string>

namespace rnlinux {

struct RNLinuxApplication::Impl {
  RNLinuxHost::Config config;
  GtkApplication* app = nullptr;
  GtkWidget* window = nullptr;
  GtkWidget* rootView = nullptr;  // GtkFixed used as the Fabric root container
  std::unique_ptr<RNLinuxHost> host;
  std::shared_ptr<LinuxMountingManager> mountingManager;
  GFileMonitor* bundleMonitor = nullptr;
  guint reloadDebounceSource = 0;
};

namespace {

// Strip the leading "file://" from a bundle URL, returning a (possibly
// empty) absolute path. Returns empty for any non-file scheme.
std::string fileSchemePath(const std::string& url) {
  constexpr const char* kPrefix = "file://";
  if (url.compare(0, std::strlen(kPrefix), kPrefix) == 0) {
    return url.substr(std::strlen(kPrefix));
  }
  return {};
}

gboolean fireReload(gpointer userData) {
  auto* impl = static_cast<RNLinuxApplication::Impl*>(userData);
  impl->reloadDebounceSource = 0;
  if (impl->host) {
    RNL_LOGI("HotReload") << "bundle changed on disk — reloading";
    impl->host->reload();
  }
  return G_SOURCE_REMOVE;
}

void onBundleChanged(GFileMonitor* /*monitor*/, GFile* /*file*/,
                     GFile* /*other*/, GFileMonitorEvent event,
                     gpointer userData) {
  // Multiple events fire per write (CHANGED, CHANGES_DONE_HINT,
  // ATTRIBUTE_CHANGED). Coalesce to a single reload by re-arming a
  // 150ms timer; bundlers write in bursts and we only want the final
  // settled state.
  if (event != G_FILE_MONITOR_EVENT_CHANGES_DONE_HINT &&
      event != G_FILE_MONITOR_EVENT_CREATED &&
      event != G_FILE_MONITOR_EVENT_MOVED_IN) {
    return;
  }
  auto* impl = static_cast<RNLinuxApplication::Impl*>(userData);
  if (impl->reloadDebounceSource) {
    g_source_remove(impl->reloadDebounceSource);
  }
  impl->reloadDebounceSource = g_timeout_add(150, fireReload, impl);
}

}  // namespace

void RNLinuxApplication::onActivate(GtkApplication* app, void* userData) {
  auto* impl = static_cast<Impl*>(userData);

  impl->window = gtk_application_window_new(app);
  gtk_window_set_title(GTK_WINDOW(impl->window),
                       impl->config.windowTitle.c_str());
  gtk_window_set_default_size(GTK_WINDOW(impl->window),
                              impl->config.initialWidth,
                              impl->config.initialHeight);

  impl->rootView = gtk_fixed_new();
  gtk_window_set_child(GTK_WINDOW(impl->window), impl->rootView);

  // Pre-Fabric placeholder so the window isn't blank while the host is
  // still being wired up. The mounting layer will replace this with the
  // real React tree once Phase 5.3 lands; in the meantime a visible
  // "Hello" doubles as a sanity check that GTK + CSS + Pango all work.
  GtkWidget* placeholder = gtk_label_new(nullptr);
  gtk_label_set_use_markup(GTK_LABEL(placeholder), TRUE);
  gtk_label_set_markup(GTK_LABEL(placeholder),
      "<span size=\"xx-large\" weight=\"bold\">Hello from React Native on Linux</span>\n"
      "<span size=\"medium\" foreground=\"#888\">"
      "vnext is running — Hermes alive, Fabric pending (Phase 5.3)"
      "</span>");
  gtk_label_set_justify(GTK_LABEL(placeholder), GTK_JUSTIFY_CENTER);
  gtk_widget_set_halign(placeholder, GTK_ALIGN_CENTER);
  gtk_widget_set_valign(placeholder, GTK_ALIGN_CENTER);
  // GtkFixed positions children by absolute coords — center roughly in the
  // 1024x720 default window.
  gtk_fixed_put(GTK_FIXED(impl->rootView), placeholder,
                impl->config.initialWidth / 2 - 220,
                impl->config.initialHeight / 2 - 30);

  // Wire up the Fabric mounting manager to the root widget.
  impl->mountingManager =
      std::make_shared<LinuxMountingManager>(impl->rootView);
  impl->host = std::make_unique<RNLinuxHost>(impl->config);
  impl->host->setMountingManager(impl->mountingManager);

  // Lightning-path bridge: install the rnLinux JSI bindings *before* the
  // bundle is evaluated so JS sees `globalThis.rnLinux` at top level.
  GtkWidget* rootForJs = impl->rootView;
  impl->host->setBeforeBundleEvalHook(
      [rootForJs](facebook::jsi::Runtime& rt) {
    installRnLinuxBindings(rt, rootForJs);
  });

  impl->host->start();

  // Phase 5.3: register a real Fabric SurfaceHandler with the Scheduler.
  // The JS-side `AppRegistry.registerComponent(name, ...)` must use the
  // same module name we pass here for the renderer to find the component
  // to mount.
  auto& surface =
      impl->host->createSurface(impl->config.applicationId, "{}");
  impl->host->startSurface(surface);

  // Hot reload — watch the bundle file. Only meaningful for file://
  // bundles; HTTP loaders would need to poll Metro instead.
  if (!impl->bundleMonitor) {
    auto bundlePath = fileSchemePath(impl->config.bundleUrl);
    if (!bundlePath.empty()) {
      GFile* gf = g_file_new_for_path(bundlePath.c_str());
      GError* err = nullptr;
      impl->bundleMonitor = g_file_monitor_file(
          gf, G_FILE_MONITOR_NONE, nullptr, &err);
      g_object_unref(gf);
      if (impl->bundleMonitor) {
        g_signal_connect(impl->bundleMonitor, "changed",
                         G_CALLBACK(onBundleChanged), impl);
        RNL_LOGI("HotReload") << "watching " << bundlePath;
      } else if (err) {
        RNL_LOGW("HotReload") << "failed to watch bundle: " << err->message;
        g_error_free(err);
      }
    }
  }

  gtk_window_present(GTK_WINDOW(impl->window));
  RNL_LOGI("RNLinuxApplication") << "window presented";
}

void RNLinuxApplication::onShutdown(GtkApplication*, void* userData) {
  auto* impl = static_cast<Impl*>(userData);
  if (impl->reloadDebounceSource) {
    g_source_remove(impl->reloadDebounceSource);
    impl->reloadDebounceSource = 0;
  }
  if (impl->bundleMonitor) {
    g_object_unref(impl->bundleMonitor);
    impl->bundleMonitor = nullptr;
  }
  if (impl->host) {
    impl->host->stop();
  }
}

RNLinuxApplication::RNLinuxApplication(RNLinuxHost::Config config)
    : impl_(std::make_unique<Impl>()) {
  // Install before any work — we want a usable backtrace if the runtime
  // itself crashes during ctor / GTK init.
  installCrashHandler();
  impl_->config = std::move(config);
}

RNLinuxApplication::~RNLinuxApplication() {
  if (impl_->app) {
    g_object_unref(impl_->app);
  }
}

int RNLinuxApplication::run(int argc, char** argv) {
  impl_->app = gtk_application_new(impl_->config.applicationId.c_str(),
                                   G_APPLICATION_DEFAULT_FLAGS);
  g_signal_connect(impl_->app, "activate", G_CALLBACK(onActivate), impl_.get());
  g_signal_connect(impl_->app, "shutdown", G_CALLBACK(onShutdown), impl_.get());
  return g_application_run(G_APPLICATION(impl_->app), argc, argv);
}

}  // namespace rnlinux
