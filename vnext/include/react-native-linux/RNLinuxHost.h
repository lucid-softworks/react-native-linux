#pragma once

#include <functional>
#include <memory>
#include <string>

namespace facebook::jsi {
class Runtime;
}

namespace facebook::react {
class ReactInstance;
class Scheduler;
class SurfaceHandler;
}  // namespace facebook::react

namespace rnlinux {

class LinuxMountingManager;
class HermesRuntimeHolder;

// RNLinuxHost owns the React Native instance + Hermes runtime. It is platform
// aware only insofar as it knows how to hand mounting transactions to a
// LinuxMountingManager (which talks to GTK4 on the UI thread).
//
// Lifecycle:
//   1. Construct with a Config.
//   2. start() spawns the JS thread, creates the Hermes runtime, loads the
//      bundle, and prepares a Scheduler.
//   3. createSurface(moduleName, props) returns a SurfaceHandler the caller
//      attaches to a native root view.
//   4. stop() tears everything down.
class RNLinuxHost {
 public:
  struct Config {
    std::string applicationId;
    // Vendor bundle: React + reconciler + react-refresh + our runtime.
    // Loaded once on start; never re-evaluated by reload(). Empty
    // means "single-bundle mode" — bundleUrl is used for everything.
    std::string vendorBundleUrl;
    std::string bundleUrl;       // app bundle (file:// or http://)
    std::string windowTitle;
    int initialWidth = 800;
    int initialHeight = 600;
    int pointScaleFactor = 1;    // updated from gdk_monitor_get_scale_factor
  };

  explicit RNLinuxHost(Config config);
  ~RNLinuxHost();

  RNLinuxHost(const RNLinuxHost&) = delete;
  RNLinuxHost& operator=(const RNLinuxHost&) = delete;

  void start();
  void stop();
  void reload();
  // Hot-reload variant: re-evaluate the given source on the existing
  // Hermes runtime. Used by the HMR socket so esbuild can push bundles
  // directly to the live process — no file IO, no GFileMonitor.
  void reloadFromSource(std::string source, std::string sourceUrl);

  // Attach a LinuxMountingManager so the Scheduler knows where to send
  // mounting transactions.
  void setMountingManager(std::shared_ptr<LinuxMountingManager> manager);

  // Hook fired by start() *after* the Hermes runtime is constructed but
  // *before* the bundle is loaded/evaluated. Use it to install JSI host
  // functions / globals (e.g. our lightning-path rnLinux bridge) so the
  // bundle sees them at top level.
  void setBeforeBundleEvalHook(
      std::function<void(facebook::jsi::Runtime&)> hook);

  // Surface management. The returned SurfaceHandler is owned by the host;
  // callers receive a non-owning reference.
  facebook::react::SurfaceHandler& createSurface(
      std::string moduleName,
      std::string initialPropsJson);

  void startSurface(facebook::react::SurfaceHandler& surface);
  void stopSurface(facebook::react::SurfaceHandler& surface);

  const Config& config() const { return config_; }

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  Config config_;
};

}  // namespace rnlinux
