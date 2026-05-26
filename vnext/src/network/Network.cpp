#include "Network.h"

#include <arpa/inet.h>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <gio/gio.h>
#include <ifaddrs.h>
#include <linux/if_packet.h>
#include <net/if.h>
#include <sstream>
#include <sys/socket.h>

namespace rnlinux::network {

namespace {

std::string slurp(const std::string& path) {
  std::ifstream f(path);
  if (!f.is_open())
    return {};
  std::stringstream ss;
  ss << f.rdbuf();
  std::string out = ss.str();
  while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' '))
    out.pop_back();
  return out;
}

// `/sys/class/net/<iface>/type` is one of the ARPHRD_* constants
// from <linux/if_arp.h>. 1 = ethernet, 24/772 = loopback,
// 778 = ieee802.11_radiotap, 803/801 = WiFi. We only need a coarse
// classification here — the kernel constant rather than walking
// every wifi-driver-specific value would be inadequate alone, so
// we also look at the prefix the udev rules tend to generate:
//   - eth* / enp* / eno* / ens* / em* → ethernet
//   - wl* / wlan* / wlp*               → wifi
//   - wwan* / ppp* / rmnet*            → cellular
//   - bnep* / pan*                     → bluetooth
//   - tun* / tap* / vpn* / wg*         → vpn
NetType classifyInterface(const std::string& iface) {
  const std::string type = slurp("/sys/class/net/" + iface + "/type");
  // Loopback first — never report it as the active type.
  if (type == "772" || type == "24")
    return NetType::None;
  // Prefix-based classification covers the rest with high
  // reliability on modern Linux.
  auto starts = [&](const char* p) { return iface.rfind(p, 0) == 0; };
  if (starts("wl"))
    return NetType::Wifi;
  if (starts("wwan") || starts("ppp") || starts("rmnet"))
    return NetType::Cellular;
  if (starts("bnep") || starts("pan"))
    return NetType::Bluetooth;
  if (starts("tun") || starts("tap") || starts("vpn") || starts("wg"))
    return NetType::Vpn;
  if (starts("eth") || starts("en") || starts("em"))
    return NetType::Ethernet;
  // Fall back to the kernel type code for anything not matched
  // above — ethernet (1) for unknown wired interfaces (rare).
  if (type == "1")
    return NetType::Ethernet;
  return NetType::Unknown;
}

// Walk /sys/class/net looking for the first interface that's
// `up` AND has a routable address. Loopback is excluded by the
// classify step above.
struct ActiveInterface {
  std::string name;
  NetType type = NetType::None;
};

ActiveInterface findActive() {
  ActiveInterface out;
  DIR* d = opendir("/sys/class/net");
  if (!d)
    return out;
  struct dirent* ent;
  while ((ent = readdir(d))) {
    const std::string name = ent->d_name;
    if (name == "." || name == "..")
      continue;
    const std::string operstate = slurp("/sys/class/net/" + name + "/operstate");
    if (operstate != "up")
      continue;
    NetType type = classifyInterface(name);
    if (type == NetType::None || type == NetType::Unknown)
      continue;
    out.name = name;
    out.type = type;
    break;
  }
  closedir(d);
  return out;
}

// Mirror of the helper in DeviceInfo.cpp — kept inline so the
// network module doesn't take a dependency on a sibling
// component's internal implementation file. ifaddrs is cheap.
std::string primaryIPv4ForIface(const std::string& iface) {
  struct ifaddrs* head = nullptr;
  if (getifaddrs(&head) != 0 || !head)
    return {};
  std::string out;
  for (auto* ifa = head; ifa; ifa = ifa->ifa_next) {
    if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_INET)
      continue;
    if (!iface.empty() && iface != ifa->ifa_name)
      continue;
    if (!(ifa->ifa_flags & IFF_UP) || (ifa->ifa_flags & IFF_LOOPBACK))
      continue;
    char buf[INET_ADDRSTRLEN] = {0};
    auto* sin = reinterpret_cast<sockaddr_in*>(ifa->ifa_addr);
    if (inet_ntop(AF_INET, &sin->sin_addr, buf, sizeof(buf))) {
      out = buf;
      break;
    }
  }
  freeifaddrs(head);
  return out;
}

std::string macForIface(const std::string& iface) {
  if (iface.empty())
    return {};
  return slurp("/sys/class/net/" + iface + "/address");
}

} // namespace

const char* typeString(NetType t) {
  switch (t) {
  case NetType::None:
    return "NONE";
  case NetType::Wifi:
    return "WIFI";
  case NetType::Cellular:
    return "CELLULAR";
  case NetType::Ethernet:
    return "ETHERNET";
  case NetType::Bluetooth:
    return "BLUETOOTH";
  case NetType::Vpn:
    return "VPN";
  case NetType::Unknown:
  default:
    return "UNKNOWN";
  }
}

// ─── Listener plumbing ────────────────────────────────────────────

namespace {

struct ListenerState {
  StateListener cb;
  gulong signalId = 0;
  GNetworkMonitor* monitor = nullptr;
};

ListenerState& listenerState() {
  static ListenerState s;
  return s;
}

// Idle callback so the listener runs on the next main-loop tick
// instead of synchronously inside GNetworkMonitor's signal
// emission — keeps the JS callback well clear of any GLib
// reentrancy.
gboolean fireOnIdle(gpointer) {
  auto& s = listenerState();
  if (s.cb) {
    s.cb(getState());
  }
  return G_SOURCE_REMOVE;
}

void onNetworkChanged(GNetworkMonitor*, gboolean, gpointer) {
  g_idle_add(fireOnIdle, nullptr);
}

} // namespace

void setStateListener(StateListener cb) {
  auto& s = listenerState();
  s.cb = std::move(cb);
  if (s.cb) {
    if (!s.monitor) {
      s.monitor = g_network_monitor_get_default();
    }
    if (s.monitor && s.signalId == 0) {
      s.signalId =
          g_signal_connect(s.monitor, "network-changed", G_CALLBACK(onNetworkChanged), nullptr);
    }
  } else {
    if (s.monitor && s.signalId != 0) {
      g_signal_handler_disconnect(s.monitor, s.signalId);
      s.signalId = 0;
    }
  }
}

void reset() {
  setStateListener(nullptr);
}

namespace {

// IPv6 variant of primaryIPv4ForIface — most interfaces have both
// AF_INET and AF_INET6 entries in getifaddrs; report whichever
// looks usable (skip link-local fe80::/10 unless that's all there
// is). Returns empty when the iface has no usable v6 address.
std::string primaryIPv6ForIface(const std::string& iface) {
  struct ifaddrs* head = nullptr;
  if (getifaddrs(&head) != 0 || !head)
    return {};
  std::string preferred;
  std::string linkLocal;
  for (auto* ifa = head; ifa; ifa = ifa->ifa_next) {
    if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_INET6)
      continue;
    if (!iface.empty() && iface != ifa->ifa_name)
      continue;
    if (!(ifa->ifa_flags & IFF_UP))
      continue;
    auto* sin6 = reinterpret_cast<sockaddr_in6*>(ifa->ifa_addr);
    char buf[INET6_ADDRSTRLEN] = {0};
    if (!inet_ntop(AF_INET6, &sin6->sin6_addr, buf, sizeof(buf)))
      continue;
    const std::string addr = buf;
    // fe80::/10 is link-local; treat as a last resort. Routable
    // addresses (2000::/3, fd00::/8, ::1 loopback) win.
    if (addr.rfind("fe80:", 0) == 0) {
      if (linkLocal.empty())
        linkLocal = addr;
    } else {
      preferred = addr;
      break;
    }
  }
  freeifaddrs(head);
  return preferred.empty() ? linkLocal : preferred;
}

} // namespace

std::vector<NetworkInterface> listInterfaces() {
  std::vector<NetworkInterface> out;
  DIR* d = opendir("/sys/class/net");
  if (!d)
    return out;
  struct dirent* ent;
  while ((ent = readdir(d))) {
    const std::string name = ent->d_name;
    if (name == "." || name == "..")
      continue;
    NetworkInterface iface;
    iface.name = name;
    // operstate file is one of "up", "down", "dormant", "unknown".
    // We surface a binary up/down so consumers don't have to
    // memorize the kernel's state names; "dormant" gets lumped
    // with down since it's not carrying traffic.
    iface.isUp = slurp("/sys/class/net/" + name + "/operstate") == "up";
    iface.type = classifyInterface(name);
    iface.macAddress = macForIface(name);
    iface.ipv4 = primaryIPv4ForIface(name);
    iface.ipv6 = primaryIPv6ForIface(name);
    out.push_back(std::move(iface));
  }
  closedir(d);
  return out;
}

bool isAirplaneModeEnabled() {
  // /sys/class/rfkill/rfkillN/{type,soft} is the kernel-exposed
  // rfkill state. We treat "airplane mode" as "every wireless
  // radio is soft-blocked". `hard` blocks (hardware switch) are
  // intentionally NOT required — many laptops have only soft
  // blocks toggled by the airplane key, and the user expectation
  // matches that.
  DIR* d = opendir("/sys/class/rfkill");
  if (!d)
    return false;
  bool sawAny = false;
  bool allBlocked = true;
  struct dirent* ent;
  while ((ent = readdir(d))) {
    const std::string name = ent->d_name;
    if (name.rfind("rfkill", 0) != 0)
      continue;
    const std::string base = std::string("/sys/class/rfkill/") + name + "/";
    const std::string type = slurp(base + "type");
    // Skip device types that aren't "wireless" in the user's
    // sense. nfc is borderline but not part of airplane mode UX.
    if (type != "wlan" && type != "bluetooth" && type != "wwan" && type != "gps" &&
        type != "wimax" && type != "uwb")
      continue;
    sawAny = true;
    const std::string soft = slurp(base + "soft");
    if (soft != "1") {
      allBlocked = false;
      break;
    }
  }
  closedir(d);
  return sawAny && allBlocked;
}

NetworkState getState() {
  NetworkState s;
  ActiveInterface active = findActive();
  s.interfaceName = active.name;
  s.type = active.type;
  if (!active.name.empty()) {
    s.ipAddress = primaryIPv4ForIface(active.name);
    s.macAddress = macForIface(active.name);
  }
  // GNetworkMonitor for the binary "up?" + "internet?" signals.
  // Default monitor on GIO 2.x picks NetworkManager when present,
  // netlink monitor otherwise. Net result: works on basically
  // anything that runs glib.
  GNetworkMonitor* mon = g_network_monitor_get_default();
  if (mon) {
    s.isConnected = g_network_monitor_get_network_available(mon);
    GNetworkConnectivity conn = g_network_monitor_get_connectivity(mon);
    s.isInternetReachable = conn == G_NETWORK_CONNECTIVITY_FULL;
  } else {
    // No GNetworkMonitor — fall back to "have IP -> assume up".
    // Less accurate (no internet vs LAN distinction) but it's
    // better than always-false.
    s.isConnected = !s.ipAddress.empty();
    s.isInternetReachable = s.isConnected;
  }
  if (s.type == NetType::Unknown && s.isConnected)
    s.type = NetType::Ethernet; // best guess for an active link
  return s;
}

} // namespace rnlinux::network
