#include "react-native-linux/RNLinuxApplication.h"
#include "react-native-linux/CrashHandler.h"
#include "react-native-linux/Logging.h"

#include "fabric/LinuxMountingManager.h"

#include <gtk/gtk.h>

#include <memory>

namespace rnlinux {

struct RNLinuxApplication::Impl {
  RNLinuxHost::Config config;
  GtkApplication* app = nullptr;
  GtkWidget* window = nullptr;
  GtkWidget* rootView = nullptr;  // GtkFixed used as the Fabric root container
  std::unique_ptr<RNLinuxHost> host;
  std::shared_ptr<LinuxMountingManager> mountingManager;
};

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
  impl->host->start();

  // TODO: Once createSurface returns a real SurfaceHandler, set its layout
  // constraints to (initialWidth, initialHeight) and attach the surface ID to
  // the mounting manager so it knows which root to mount under.
  impl->host->createSurface(impl->config.applicationId, "{}");

  gtk_window_present(GTK_WINDOW(impl->window));
  RNL_LOGI("RNLinuxApplication") << "window presented";
}

void RNLinuxApplication::onShutdown(GtkApplication*, void* userData) {
  auto* impl = static_cast<Impl*>(userData);
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
