#include "Location.h"

#include "react-native-linux/Logging.h"

#include <cmath>
#include <cstring>
#include <ctime>
#include <dirent.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

namespace rnlinux::location {

namespace {

constexpr const char* kBusName = "org.freedesktop.GeoClue2";
constexpr const char* kManagerPath = "/org/freedesktop/GeoClue2/Manager";
constexpr const char* kManagerIface = "org.freedesktop.GeoClue2.Manager";
constexpr const char* kClientIface = "org.freedesktop.GeoClue2.Client";
constexpr const char* kLocationIface = "org.freedesktop.GeoClue2.Location";
constexpr const char* kPropsIface = "org.freedesktop.DBus.Properties";
constexpr const char* kDBusPath = "/org/freedesktop/DBus";
constexpr const char* kDBusName = "org.freedesktop.DBus";
constexpr const char* kDBusIface = "org.freedesktop.DBus";

// The geoclue-2.0 package ships a tiny always-yes agent here. Its
// desktop id (`geoclue-demo-agent`) is in the default
// `/etc/geoclue/geoclue.conf` [agent] whitelist, so it can register
// without further config. If this binary doesn't exist on the host,
// startWatch will surface a clear "agent not installed" error.
constexpr const char* kDemoAgentBin = "/usr/libexec/geoclue-2.0/demos/agent";

// Helper: read a single double property from a GeoClue2 Location object.
// Returns the default on any DBus error so a partially-populated fix
// is still serializable up to JS.
double readDoubleProp(GDBusConnection* bus, const char* path, const char* prop, double fallback) {
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(bus,
                                                kBusName,
                                                path,
                                                kPropsIface,
                                                "Get",
                                                g_variant_new("(ss)", kLocationIface, prop),
                                                G_VARIANT_TYPE("(v)"),
                                                G_DBUS_CALL_FLAGS_NONE,
                                                2000,
                                                nullptr,
                                                &err);
  if (!reply) {
    if (err) {
      RNL_LOGW("rnLinux.location") << "read " << prop << " failed: " << err->message;
      g_error_free(err);
    }
    return fallback;
  }
  GVariant* boxed = nullptr;
  g_variant_get(reply, "(v)", &boxed);
  double v = fallback;
  if (boxed && g_variant_is_of_type(boxed, G_VARIANT_TYPE_DOUBLE)) {
    v = g_variant_get_double(boxed);
  }
  if (boxed)
    g_variant_unref(boxed);
  g_variant_unref(reply);
  return v;
}

// Wall-clock now in ms — used when GeoClue's timestamp tuple is
// unavailable. GeoClue's Timestamp is a (tt) (seconds, microseconds)
// pair we could parse instead; keeping this simple for the smoke
// demo.
int64_t nowMs() {
  struct timespec ts {};
  clock_gettime(CLOCK_REALTIME, &ts);
  return static_cast<int64_t>(ts.tv_sec) * 1000 + ts.tv_nsec / 1000000;
}

} // namespace

LocationClient::LocationClient(std::string desktopId)
    : desktopId_(std::move(desktopId)) {}

LocationClient::~LocationClient() {
  stopWatch();
}

bool LocationClient::ensureBus(std::string& errOut) {
  if (bus_)
    return true;
  GError* err = nullptr;
  bus_ = g_bus_get_sync(G_BUS_TYPE_SYSTEM, nullptr, &err);
  if (!bus_) {
    errOut = err && err->message ? err->message : "system bus unavailable";
    if (err)
      g_error_free(err);
    return false;
  }
  return true;
}

bool LocationClient::isAvailable() {
  std::string errIgnored;
  if (!ensureBus(errIgnored))
    return false;
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(bus_,
                                                kDBusName,
                                                kDBusPath,
                                                kDBusIface,
                                                "NameHasOwner",
                                                g_variant_new("(s)", kBusName),
                                                G_VARIANT_TYPE("(b)"),
                                                G_DBUS_CALL_FLAGS_NONE,
                                                500,
                                                nullptr,
                                                &err);
  if (!reply) {
    if (err)
      g_error_free(err);
    return false;
  }
  gboolean owned = FALSE;
  g_variant_get(reply, "(b)", &owned);
  g_variant_unref(reply);
  if (owned)
    return true;
  // GeoClue is bus-activated — NameHasOwner returns false until the
  // first method call wakes it up. Send a cheap method to trigger
  // activation, then return true. The agent check happens on
  // startWatch, so we don't conflate "service installed" with
  // "service usable" here.
  err = nullptr;
  GVariant* probe = g_dbus_connection_call_sync(bus_,
                                                kDBusName,
                                                kDBusPath,
                                                kDBusIface,
                                                "StartServiceByName",
                                                g_variant_new("(su)", kBusName, 0u),
                                                G_VARIANT_TYPE("(u)"),
                                                G_DBUS_CALL_FLAGS_NONE,
                                                1000,
                                                nullptr,
                                                &err);
  if (probe)
    g_variant_unref(probe);
  if (err) {
    g_error_free(err);
    return false;
  }
  return true;
}

// Walk /proc and look for an existing process whose executable path
// matches the demo agent binary. Cheaper and more reliable than asking
// dbus — the agent registers via Manager.AddAgent, not a well-known
// name, so there's no NameHasOwner equivalent to query for it.
static bool agentAlreadyRunning() {
  DIR* d = opendir("/proc");
  if (!d)
    return false;
  bool found = false;
  struct dirent* ent;
  while ((ent = readdir(d))) {
    if (ent->d_name[0] < '0' || ent->d_name[0] > '9')
      continue;
    char link[280];
    std::snprintf(link, sizeof(link), "/proc/%s/exe", ent->d_name);
    char target[256];
    ssize_t n = readlink(link, target, sizeof(target) - 1);
    if (n <= 0)
      continue;
    target[n] = '\0';
    if (std::strcmp(target, kDemoAgentBin) == 0) {
      found = true;
      break;
    }
  }
  closedir(d);
  return found;
}

bool LocationClient::ensureAgentRunning(std::string& errOut) {
  // GeoClue's Start() blocks until an authorization agent has been
  // registered via Manager.AddAgent. Desktop sessions auto-start
  // geoclue-demo-agent via XDG; bare-VM / headless sessions don't,
  // which is why CreateClient/Start hung in early bring-up.
  if (agentAlreadyRunning())
    return true;

  if (access(kDemoAgentBin, X_OK) != 0) {
    errOut = std::string("GeoClue2 agent not running and ") + kDemoAgentBin +
             " is missing. Install geoclue-2.0 or start an agent.";
    return false;
  }

  const pid_t pid = fork();
  if (pid < 0) {
    errOut = "fork() for geoclue-demo-agent failed";
    return false;
  }
  if (pid == 0) {
    setsid();
    int devnull = open("/dev/null", O_RDWR);
    if (devnull >= 0) {
      dup2(devnull, 0);
      dup2(devnull, 1);
      dup2(devnull, 2);
      if (devnull > 2)
        close(devnull);
    }
    execl(kDemoAgentBin, kDemoAgentBin, static_cast<char*>(nullptr));
    _exit(127);
  }

  // Poll /proc for the agent appearing — usually <50ms after fork.
  // Bound the wait at ~1s so a missing binary or exec failure
  // surfaces quickly. The agent itself does an async AddAgent on
  // its first iteration of the GMainLoop, and Start() on our side
  // will then block briefly until that registration lands.
  for (int i = 0; i < 20; ++i) {
    g_usleep(50 * 1000);
    if (agentAlreadyRunning())
      return true;
  }
  errOut = "GeoClue2 agent failed to start within 1s";
  return false;
}

bool LocationClient::createClient(std::string& errOut) {
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(bus_,
                                                kBusName,
                                                kManagerPath,
                                                kManagerIface,
                                                "CreateClient",
                                                nullptr,
                                                G_VARIANT_TYPE("(o)"),
                                                G_DBUS_CALL_FLAGS_NONE,
                                                5000,
                                                nullptr,
                                                &err);
  if (!reply) {
    errOut = err && err->message ? err->message : "CreateClient failed";
    if (err)
      g_error_free(err);
    return false;
  }
  const char* path = nullptr;
  g_variant_get(reply, "(&o)", &path);
  clientPath_ = std::make_unique<std::string>(path ? path : "");
  g_variant_unref(reply);
  return !clientPath_->empty();
}

bool LocationClient::setDesktopId(std::string& errOut) {
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(
      bus_,
      kBusName,
      clientPath_->c_str(),
      kPropsIface,
      "Set",
      g_variant_new("(ssv)", kClientIface, "DesktopId", g_variant_new_string(desktopId_.c_str())),
      nullptr,
      G_DBUS_CALL_FLAGS_NONE,
      2000,
      nullptr,
      &err);
  if (!reply) {
    errOut = err && err->message ? err->message : "Set DesktopId failed";
    if (err)
      g_error_free(err);
    return false;
  }
  g_variant_unref(reply);
  return true;
}

bool LocationClient::callStart(std::string& errOut) {
  GError* err = nullptr;
  GVariant* reply = g_dbus_connection_call_sync(bus_,
                                                kBusName,
                                                clientPath_->c_str(),
                                                kClientIface,
                                                "Start",
                                                nullptr,
                                                nullptr,
                                                G_DBUS_CALL_FLAGS_NONE,
                                                5000,
                                                nullptr,
                                                &err);
  if (!reply) {
    errOut = err && err->message ? err->message : "Start failed";
    if (err)
      g_error_free(err);
    return false;
  }
  g_variant_unref(reply);
  return true;
}

void LocationClient::readLocationProps(const char* path, LocationFix& out) {
  out.latitude = readDoubleProp(bus_, path, "Latitude", 0.0);
  out.longitude = readDoubleProp(bus_, path, "Longitude", 0.0);
  out.accuracy = readDoubleProp(bus_, path, "Accuracy", -1.0);
  out.altitude = readDoubleProp(bus_, path, "Altitude", 0.0);
  out.speed = readDoubleProp(bus_, path, "Speed", -1.0);
  out.heading = readDoubleProp(bus_, path, "Heading", -1.0);
  out.timestampMs = nowMs();
}

void LocationClient::onLocationSignal(const char* newLocationPath) {
  if (!newLocationPath || !onFix_)
    return;
  LocationFix fix;
  readLocationProps(newLocationPath, fix);
  onFix_(fix);
}

bool LocationClient::startWatch(OnFixCallback onFix, OnErrorCallback onError) {
  std::string err;
  if (!ensureBus(err)) {
    if (onError)
      onError(err);
    return false;
  }
  if (!ensureAgentRunning(err)) {
    if (onError)
      onError(err);
    return false;
  }
  // Replace any previous watch — single-client model. Don't carry
  // stale signal subscriptions across watches.
  stopWatch();
  if (!createClient(err) || !setDesktopId(err)) {
    if (onError)
      onError(err);
    stopWatch();
    return false;
  }

  onFix_ = std::move(onFix);
  onError_ = std::move(onError);

  subscriptionId_ = g_dbus_connection_signal_subscribe(
      bus_,
      kBusName,
      kClientIface,
      "LocationUpdated",
      clientPath_->c_str(),
      nullptr,
      G_DBUS_SIGNAL_FLAGS_NONE,
      +[](GDBusConnection* /*conn*/,
          const gchar* /*sender*/,
          const gchar* /*path*/,
          const gchar* /*iface*/,
          const gchar* /*signal*/,
          GVariant* params,
          gpointer user_data) {
        auto* self = static_cast<LocationClient*>(user_data);
        const char* oldPath = nullptr;
        const char* newPath = nullptr;
        g_variant_get(params, "(&o&o)", &oldPath, &newPath);
        self->onLocationSignal(newPath);
      },
      this,
      nullptr);

  if (!callStart(err)) {
    if (onError_)
      onError_(err);
    stopWatch();
    return false;
  }
  return true;
}

void LocationClient::stopWatch() {
  if (subscriptionId_ && bus_) {
    g_dbus_connection_signal_unsubscribe(bus_, subscriptionId_);
    subscriptionId_ = 0;
  }
  if (clientPath_ && !clientPath_->empty() && bus_) {
    // Best-effort Stop + DeleteClient. Errors don't matter at this
    // point — the daemon GCs orphaned clients on caller disconnect.
    GError* err = nullptr;
    GVariant* reply = g_dbus_connection_call_sync(bus_,
                                                  kBusName,
                                                  clientPath_->c_str(),
                                                  kClientIface,
                                                  "Stop",
                                                  nullptr,
                                                  nullptr,
                                                  G_DBUS_CALL_FLAGS_NONE,
                                                  1000,
                                                  nullptr,
                                                  &err);
    if (reply)
      g_variant_unref(reply);
    if (err)
      g_error_free(err);
  }
  clientPath_.reset();
  onFix_ = nullptr;
  onError_ = nullptr;
}

} // namespace rnlinux::location
