#include "react-native-linux/RNLinuxApplication.h"
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

namespace {

void onActivate(GtkApplication* app, gpointer userData) {
  auto* impl = static_cast<RNLinuxApplication::Impl*>(userData);

  impl->window = gtk_application_window_new(app);
  gtk_window_set_title(GTK_WINDOW(impl->window),
                       impl->config.windowTitle.c_str());
  gtk_window_set_default_size(GTK_WINDOW(impl->window),
                              impl->config.initialWidth,
                              impl->config.initialHeight);

  impl->rootView = gtk_fixed_new();
  gtk_window_set_child(GTK_WINDOW(impl->window), impl->rootView);

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

void onShutdown(GtkApplication*, gpointer userData) {
  auto* impl = static_cast<RNLinuxApplication::Impl*>(userData);
  if (impl->host) {
    impl->host->stop();
  }
}

}  // namespace

RNLinuxApplication::RNLinuxApplication(RNLinuxHost::Config config)
    : impl_(std::make_unique<Impl>()) {
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
