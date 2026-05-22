#pragma once

#include <functional>
#include <memory>
#include <string>

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
    std::string bundleUrl;       // file:// or http://
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

  // Attach a LinuxMountingManager so the Scheduler knows where to send
  // mounting transactions.
  void setMountingManager(std::shared_ptr<LinuxMountingManager> manager);

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
