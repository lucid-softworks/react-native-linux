#include "react-native-linux/RNLinuxApplication.h"

#include "fabric/LinuxMountingManager.h"
#include "jsi/RnLinuxBindings.h"
#include "react-native-linux/CrashHandler.h"
#include "react-native-linux/Logging.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <gio/gio.h>
#include <gio/gunixsocketaddress.h>
#include <gtk/gtk.h>
#include <memory>
#include <string>
#include <unistd.h>

namespace rnlinux {

struct RNLinuxApplication::Impl {
  RNLinuxHost::Config config;
  GtkApplication* app = nullptr;
  GtkWidget* window = nullptr;
  // Viewport container: a plain GtkWidget with a custom layout that
  // reports natural=(0,0) and forces its single child (rootView) to
  // fill the entire allocation. Without this wrapper the window would
  // grow to fit content (GtkFixed's natural request is its child
  // bounding box and propagates all the way up — a non-virtualized
  // FlatList for example pushes the window to ~5446 px tall).
  GtkWidget* viewport = nullptr;
  GtkWidget* rootView = nullptr; // GtkFixed used as the Fabric root container
  std::unique_ptr<RNLinuxHost> host;
  std::shared_ptr<LinuxMountingManager> mountingManager;
  GFileMonitor* bundleMonitor = nullptr;
  guint reloadDebounceSource = 0;
  // HMR push socket: a Unix domain socket the bundler connects to so it
  // can deliver a new bundle directly. Bypasses the file system path.
  GSocketService* hmrService = nullptr;
  std::string hmrSocketPath;
  // Monotonic ms-since-start of the last HMR-socket reload. The file
  // monitor checks this — if we just reloaded over the socket, ignore
  // the file change that follows.
  gint64 lastHmrReloadUs = 0;
  // Last seen viewport allocation, used by the size-poll tick to
  // dedupe — we only push into resizeRootSurface() on a real change.
  int lastWidth = -1;
  int lastHeight = -1;
  // Coalescing for the resize → Yoga commit cascade. Each commit walks
  // the full tree, so firing once per frame during a drag jitters
  // visibly. We hold the LATEST pending dimensions and let a timer
  // flush them at ~30 Hz.
  int pendingWidth = -1;
  int pendingHeight = -1;
  guint pendingResizeSource = 0;
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
  // Suppress the file-monitor reload if we just handled an HMR push
  // for the same bundle (esbuild always writes to disk after sending
  // over the socket, so the FS event lands shortly after the push).
  // 500ms is generous — a real save → reload round-trip is well under
  // it on any plausible bundler.
  if (impl->host) {
    const gint64 nowUs = g_get_monotonic_time();
    if (impl->lastHmrReloadUs && nowUs - impl->lastHmrReloadUs < 500 * 1000) {
      return G_SOURCE_REMOVE;
    }
    RNL_LOGI("HotReload") << "bundle changed on disk — reloading";
    impl->host->reload();
  }
  return G_SOURCE_REMOVE;
}

void onBundleChanged(GFileMonitor* /*monitor*/,
                     GFile* /*file*/,
                     GFile* /*other*/,
                     GFileMonitorEvent event,
                     gpointer userData) {
  // Multiple events fire per write (CHANGED, CHANGES_DONE_HINT,
  // ATTRIBUTE_CHANGED). Coalesce to a single reload by re-arming a
  // 30ms timer. esbuild writes the bundle atomically (rename of a
  // temp file) so we don't need a long settling window; 30ms is just
  // enough to absorb the burst of monitor events.
  if (event != G_FILE_MONITOR_EVENT_CHANGES_DONE_HINT && event != G_FILE_MONITOR_EVENT_CREATED &&
      event != G_FILE_MONITOR_EVENT_MOVED_IN) {
    return;
  }
  auto* impl = static_cast<RNLinuxApplication::Impl*>(userData);
  if (impl->reloadDebounceSource) {
    g_source_remove(impl->reloadDebounceSource);
  }
  impl->reloadDebounceSource = g_timeout_add(30, fireReload, impl);
}

// HMR push protocol — every connection delivers exactly one bundle.
// Wire format:
//   uint32_t LE length     (size of source bytes)
//   uint8_t  source[length]
// Client closes after writing. No response. No version negotiation.
//
// This sidesteps the disk → GFileMonitor → debounce → load round-trip
// that file-based reload takes (~150ms on lima/qemu VMs). End-to-end
// latency on a save now drops to "esbuild rebuild time + socket round
// trip + Hermes eval" ≈ 30ms.
gboolean readBundleFromSocket(GSocketService* /*service*/,
                              GSocketConnection* connection,
                              GObject* /*sourceObject*/,
                              gpointer userData) {
  auto* impl = static_cast<RNLinuxApplication::Impl*>(userData);
  auto* stream = G_INPUT_STREAM(g_io_stream_get_input_stream(G_IO_STREAM(connection)));

  uint32_t lenLE = 0;
  gsize total = 0;
  GError* err = nullptr;
  if (!g_input_stream_read_all(stream, &lenLE, sizeof(lenLE), &total, nullptr, &err) ||
      total != sizeof(lenLE)) {
    RNL_LOGW("HMR") << "failed to read length" << (err ? std::string(": ") + err->message : "");
    if (err)
      g_error_free(err);
    return TRUE;
  }
  const uint32_t len = GUINT32_FROM_LE(lenLE);
  if (len == 0 || len > (64u * 1024u * 1024u)) {
    RNL_LOGW("HMR") << "implausible bundle length " << len;
    return TRUE;
  }
  std::string buf;
  buf.resize(len);
  if (!g_input_stream_read_all(stream, &buf[0], len, &total, nullptr, &err) || total != len) {
    RNL_LOGW("HMR") << "short read: got " << total << " / " << len
                    << (err ? std::string(" — ") + err->message : "");
    if (err)
      g_error_free(err);
    return TRUE;
  }

  if (impl->host) {
    RNL_LOGI("HMR") << "received bundle (" << len << " bytes)";
    impl->host->reloadFromSource(std::move(buf), "hmr://app");
    impl->lastHmrReloadUs = g_get_monotonic_time();
  }
  return TRUE;
}

std::string defaultHmrSocketPath(const std::string& applicationId) {
  // Prefer XDG_RUNTIME_DIR (per-user, /run/user/<uid> on systemd
  // boxes); fall back to /tmp. Naming includes the applicationId so a
  // workstation running multiple playgrounds doesn't trip over itself.
  const char* runtimeDir = std::getenv("XDG_RUNTIME_DIR");
  std::string dir = (runtimeDir && *runtimeDir) ? runtimeDir : "/tmp";
  return dir + "/rn-linux." + applicationId + ".sock";
}

void startHmrSocket(RNLinuxApplication::Impl* impl) {
  if (impl->hmrService)
    return;
  if (const char* off = std::getenv("RN_HMR_DISABLE"); off && *off == '1') {
    return;
  }
  impl->hmrSocketPath = defaultHmrSocketPath(impl->config.applicationId);
  // Remove a stale socket from a previous run.
  ::unlink(impl->hmrSocketPath.c_str());

  GSocketAddress* addr = g_unix_socket_address_new(impl->hmrSocketPath.c_str());
  impl->hmrService = g_socket_service_new();
  GError* err = nullptr;
  if (!g_socket_listener_add_address(G_SOCKET_LISTENER(impl->hmrService),
                                     addr,
                                     G_SOCKET_TYPE_STREAM,
                                     G_SOCKET_PROTOCOL_DEFAULT,
                                     nullptr,
                                     nullptr,
                                     &err)) {
    RNL_LOGW("HMR") << "could not bind " << impl->hmrSocketPath << ": "
                    << (err ? err->message : "(unknown)");
    if (err)
      g_error_free(err);
    g_object_unref(impl->hmrService);
    impl->hmrService = nullptr;
    g_object_unref(addr);
    return;
  }
  g_object_unref(addr);

  g_signal_connect(impl->hmrService, "incoming", G_CALLBACK(readBundleFromSocket), impl);
  g_socket_service_start(impl->hmrService);
  RNL_LOGI("HMR") << "push socket listening at " << impl->hmrSocketPath;
}

} // namespace

void RNLinuxApplication::onActivate(GtkApplication* app, void* userData) {
  auto* impl = static_cast<Impl*>(userData);

  impl->window = gtk_application_window_new(app);
  gtk_window_set_title(GTK_WINDOW(impl->window), impl->config.windowTitle.c_str());
  gtk_window_set_default_size(
      GTK_WINDOW(impl->window), impl->config.initialWidth, impl->config.initialHeight);

  impl->rootView = gtk_fixed_new();
  // Clip the React tree to rootView's allocation so a transient overflow
  // during the resize → Yoga-relayout window doesn't bleed into the
  // window background. (rootView's natural is the React root's frame,
  // which RNLinuxHost pins to max(viewport, design size) — so rootView
  // is never smaller than the viewport, and we never want hexpand/
  // vexpand: GTK would stretch the child to the viewport and defeat
  // GtkScrolledWindow's scrolling.)
  gtk_widget_set_overflow(impl->rootView, GTK_OVERFLOW_HIDDEN);

  // GtkScrolledWindow as the window's child:
  //   * propagate-natural-*=FALSE + min-content-*=0 → its natural is 0
  //     in both dimensions, so the window doesn't grow to fit content
  //     (the bug that pushed us to ~5446 px tall before).
  //   * policy=AUTOMATIC → scrollbars appear iff the child's natural
  //     exceeds the viewport, giving us app-level scrollbars when an
  //     app's React tree is taller than the window.
  impl->viewport = gtk_scrolled_window_new();
  gtk_scrolled_window_set_policy(
      GTK_SCROLLED_WINDOW(impl->viewport), GTK_POLICY_AUTOMATIC, GTK_POLICY_AUTOMATIC);
  // GTK4 defaults to overlay scrolling (bars fade out when not hovered).
  // We want them always visible when present — they're a stronger
  // signal that there's more content off-screen than the fade-in idiom.
  gtk_scrolled_window_set_overlay_scrolling(GTK_SCROLLED_WINDOW(impl->viewport), FALSE);
  gtk_scrolled_window_set_propagate_natural_width(GTK_SCROLLED_WINDOW(impl->viewport), FALSE);
  gtk_scrolled_window_set_propagate_natural_height(GTK_SCROLLED_WINDOW(impl->viewport), FALSE);
  gtk_scrolled_window_set_min_content_width(GTK_SCROLLED_WINDOW(impl->viewport), 0);
  gtk_scrolled_window_set_min_content_height(GTK_SCROLLED_WINDOW(impl->viewport), 0);
  gtk_scrolled_window_set_child(GTK_SCROLLED_WINDOW(impl->viewport), impl->rootView);
  gtk_window_set_child(GTK_WINDOW(impl->window), impl->viewport);

  // Pre-Fabric placeholder disabled while we debug the Fabric mount
  // path. The real React tree should arrive via either the JSI bridge
  // (apps/playground/index.jsx, currently commented) or the Fabric
  // mount pipeline (apps/playground/runtime/fabric.js).

  // Wire up the Fabric mounting manager to the root widget.
  impl->mountingManager = std::make_shared<LinuxMountingManager>(impl->rootView);
  impl->host = std::make_unique<RNLinuxHost>(impl->config);
  impl->host->setMountingManager(impl->mountingManager);

  // Lookup callback so the Animated native-driver JSI binding can
  // resolve a Fabric tag → GtkWidget* without round-tripping through
  // React. Captured by-value here so the mounting manager keeps it
  // alive across reloads (the host keeps holding our shared_ptr).
  {
    std::weak_ptr<LinuxMountingManager> mmWeak = impl->mountingManager;
    setFabricWidgetLookupForJsi([mmWeak](int tag) -> GtkWidget* {
      auto mm = mmWeak.lock();
      if (!mm)
        return nullptr;
      auto* view = mm->registry().lookup(tag);
      return view ? view->widget() : nullptr;
    });
  }

  // Lightning-path bridge: install the rnLinux JSI bindings *before* the
  // bundle is evaluated so JS sees `globalThis.rnLinux` at top level.
  GtkWidget* rootForJs = impl->rootView;
  impl->host->setBeforeBundleEvalHook(
      [rootForJs](facebook::jsi::Runtime& rt) { installRnLinuxBindings(rt, rootForJs); });

  impl->host->start();

  // Phase 5.3: register a real Fabric SurfaceHandler with the Scheduler.
  // The JS-side `AppRegistry.registerComponent(name, ...)` must use the
  // same module name we pass here for the renderer to find the component
  // to mount.
  auto& surface = impl->host->createSurface(impl->config.applicationId, "{}");
  impl->host->startSurface(surface);

  // Hot reload — watch the bundle file. Only meaningful for file://
  // bundles; HTTP loaders would need to poll Metro instead.
  if (!impl->bundleMonitor) {
    auto bundlePath = fileSchemePath(impl->config.bundleUrl);
    if (!bundlePath.empty()) {
      GFile* gf = g_file_new_for_path(bundlePath.c_str());
      GError* err = nullptr;
      impl->bundleMonitor = g_file_monitor_file(gf, G_FILE_MONITOR_NONE, nullptr, &err);
      g_object_unref(gf);
      if (impl->bundleMonitor) {
        g_signal_connect(impl->bundleMonitor, "changed", G_CALLBACK(onBundleChanged), impl);
        RNL_LOGI("HotReload") << "watching " << bundlePath;
      } else if (err) {
        RNL_LOGW("HotReload") << "failed to watch bundle: " << err->message;
        g_error_free(err);
      }
    }
  }

  // HMR push socket — paired with apps/playground/bundle.mjs's watch
  // mode. esbuild's onEnd hook connects, writes a length-prefixed
  // bundle, disconnects. We re-evaluate immediately.
  startHmrSocket(impl);

  // Viewport size → Fabric LayoutConstraints. The viewport widget's
  // allocation is exactly the area GTK gave us to draw into (window
  // content area, exclusive of CSD). Tick callback so we catch every
  // resize path — explicit resize, maximize, fullscreen, snap-tile —
  // without juggling a separate signal per source. Dedupe via
  // lastWidth/lastHeight so steady-state ticks are cheap.
  gtk_widget_add_tick_callback(
      impl->viewport,
      +[](GtkWidget* w, GdkFrameClock* /*clock*/, gpointer userData) -> gboolean {
        auto* impl = static_cast<RNLinuxApplication::Impl*>(userData);
        if (!impl->host)
          return G_SOURCE_CONTINUE;
        const int width = gtk_widget_get_width(w);
        const int height = gtk_widget_get_height(w);
        if (width <= 0 || height <= 0)
          return G_SOURCE_CONTINUE;
        if (width == impl->lastWidth && height == impl->lastHeight) {
          return G_SOURCE_CONTINUE;
        }
        impl->lastWidth = width;
        impl->lastHeight = height;
        impl->pendingWidth = width;
        impl->pendingHeight = height;
        // Coalesce: at most one Yoga commit per ~33 ms even if the WM
        // hands us a configure-event every frame.
        if (impl->pendingResizeSource == 0) {
          impl->pendingResizeSource = g_timeout_add(
              33,
              +[](gpointer ud) -> gboolean {
                auto* i = static_cast<RNLinuxApplication::Impl*>(ud);
                i->pendingResizeSource = 0;
                if (i->host && i->pendingWidth > 0 && i->pendingHeight > 0) {
                  i->host->resizeRootSurface(i->pendingWidth, i->pendingHeight);
                }
                return G_SOURCE_REMOVE;
              },
              impl);
        }
        return G_SOURCE_CONTINUE;
      },
      impl,
      /*notify=*/nullptr);

  gtk_window_present(GTK_WINDOW(impl->window));
  RNL_LOGI("RNLinuxApplication") << "window presented";
}

void RNLinuxApplication::onShutdown(GtkApplication*, void* userData) {
  auto* impl = static_cast<Impl*>(userData);
  if (impl->reloadDebounceSource) {
    g_source_remove(impl->reloadDebounceSource);
    impl->reloadDebounceSource = 0;
  }
  if (impl->pendingResizeSource) {
    g_source_remove(impl->pendingResizeSource);
    impl->pendingResizeSource = 0;
  }
  if (impl->bundleMonitor) {
    g_object_unref(impl->bundleMonitor);
    impl->bundleMonitor = nullptr;
  }
  if (impl->hmrService) {
    g_socket_service_stop(impl->hmrService);
    g_object_unref(impl->hmrService);
    impl->hmrService = nullptr;
    if (!impl->hmrSocketPath.empty()) {
      ::unlink(impl->hmrSocketPath.c_str());
    }
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
  impl_->app =
      gtk_application_new(impl_->config.applicationId.c_str(), G_APPLICATION_DEFAULT_FLAGS);
  g_signal_connect(impl_->app, "activate", G_CALLBACK(onActivate), impl_.get());
  g_signal_connect(impl_->app, "shutdown", G_CALLBACK(onShutdown), impl_.get());
  return g_application_run(G_APPLICATION(impl_->app), argc, argv);
}

} // namespace rnlinux
