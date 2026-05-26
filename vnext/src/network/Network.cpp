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
