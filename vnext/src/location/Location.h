#pragma once

// GeoClue2 client for `expo-location` style APIs. Talks to the
// system-bus daemon org.freedesktop.GeoClue2 through GDBus (already
// linked transitively via GTK4). Single-watcher model — JS layers
// multiple subscribers on top via the shim. All async work runs on
// the GMainContext that owns the JS thread, so callbacks fire back
// inline without thread hops.
//
// Linux specifics that shape this design:
//  * GeoClue per-app authorization is gated by an Agent on the system
//    bus. Desktop sessions auto-start `geoclue-demo-agent`; bare
//    sessions (Lima VM, headless boxes) don't. If no agent owns the
//    name, we fork+exec the bundled demo binary on first watch so the
//    "happy path" doesn't require any extra user setup.
//  * The app's DesktopId must match an entry in
//    `/etc/geoclue/geoclue.conf` with `allowed=true; system=true` for
//    the demo agent to skip the prompt. We use `rn-linux-playground`
//    for the playground binary; consumers ship their own snippet.

#include <atomic>
#include <cstdint>
#include <functional>
#include <gio/gio.h>
#include <memory>
#include <string>

namespace rnlinux::location {

struct LocationFix {
  double latitude = 0.0;
  double longitude = 0.0;
  double accuracy = -1.0;  // meters; -1 if unknown
  double altitude = 0.0;   // meters; NaN if unknown — GeoClue uses 0
  double speed = -1.0;     // m/s; -1 if unknown (GeoClue convention)
  double heading = -1.0;   // degrees from north; -1 if unknown
  int64_t timestampMs = 0; // ms since epoch
};

using OnFixCallback = std::function<void(const LocationFix&)>;
using OnErrorCallback = std::function<void(const std::string&)>;

// `desktopId` is what GeoClue authorization checks against its
// `[application]` whitelist. Defaults to `rn-linux-playground` for
// playground builds; production apps should pass their own.
class LocationClient {
 public:
  explicit LocationClient(std::string desktopId);
  ~LocationClient();
  LocationClient(const LocationClient&) = delete;
  LocationClient& operator=(const LocationClient&) = delete;

  // True if the GeoClue2 well-known name is owned on the system bus.
  // Sync, ~1ms — uses GetNameOwner. Safe to call before startWatch.
  bool isAvailable();

  // Start streaming location fixes. `onFix` fires for every
  // LocationUpdated signal; `onError` fires once if the initial
  // CreateClient / Start sequence fails. Returns true on success.
  bool startWatch(OnFixCallback onFix, OnErrorCallback onError);

  // Tear down the GeoClue client. Calls Stop on the bus, releases
  // the client object, and clears subscriptions. Idempotent.
  void stopWatch();

  bool isWatching() const { return clientPath_ && !clientPath_->empty(); }

 private:
  bool ensureBus(std::string& errOut);
  bool ensureAgentRunning(std::string& errOut);
  bool createClient(std::string& errOut);
  bool setDesktopId(std::string& errOut);
  bool callStart(std::string& errOut);

  void onLocationSignal(const char* newLocationPath);
  void readLocationProps(const char* path, LocationFix& out);

  std::string desktopId_;
  GDBusConnection* bus_ = nullptr;          // borrowed (singleton)
  std::unique_ptr<std::string> clientPath_; // /org/freedesktop/GeoClue2/Client/N
  guint subscriptionId_ = 0;                // from g_dbus_connection_signal_subscribe
  OnFixCallback onFix_;
  OnErrorCallback onError_;
};

} // namespace rnlinux::location
