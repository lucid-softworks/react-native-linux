#pragma once

// `expo-network` backend. GIO's GNetworkMonitor handles the
// "is the network up / can we reach the internet" half — it
// auto-selects NetworkManager when present, falls back to a pure
// netlink monitor when not, so it works on any modern Linux
// without depending on NM.
//
// The "what kind of connection is this" half (wifi vs ethernet vs
// cellular) walks /sys/class/net/* and inspects each up-and-
// non-loopback interface's `type` file plus its name prefix.
// Heuristic but reliable — matches the same approach
// NetworkManager itself uses to classify devices when constructing
// device objects.

#include <functional>
#include <string>

namespace rnlinux::network {

enum class NetType {
  None,
  Unknown,
  Wifi,
  Cellular,
  Ethernet,
  Bluetooth,
  Vpn,
};

struct NetworkState {
  NetType type = NetType::Unknown;
  bool isConnected = false;
  bool isInternetReachable = false;
  std::string ipAddress;     // first non-loopback IPv4 (may be empty)
  std::string macAddress;    // matching interface MAC (may be empty)
  std::string interfaceName; // active interface name
};

// Snapshot — cheap, all-sync. Reads /sys/class/net plus a single
// GNetworkMonitor query.
NetworkState getState();

// True iff every wireless rfkill node (`type` ∈ {wlan, bluetooth,
// wwan, gps, wimax, …}) is soft-blocked, AND at least one such
// node exists. Approximates the "airplane mode" toggle most
// desktops surface in their quick-settings shade. Returns false
// on systems without rfkill (some servers, virtualized hosts).
bool isAirplaneModeEnabled();

// Convert NetType to the lowercase string expo-network's
// NetworkStateType enum uses on the JS side.
const char* typeString(NetType t);

// Single-slot state-change listener. The JS shim fans out to its
// own Set<listener> registry; we only carry one trampoline into
// the runtime. Pass nullptr to clear.
using StateListener = std::function<void(const NetworkState&)>;
void setStateListener(StateListener cb);

// Clear the listener AND drop the underlying GNetworkMonitor
// signal subscription. Called from the runtime reload path so a
// fresh JS runtime doesn't get callbacks pointing into a dead
// Hermes.
void reset();

} // namespace rnlinux::network
