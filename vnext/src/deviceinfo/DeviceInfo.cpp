#include "DeviceInfo.h"

#include <arpa/inet.h>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <fstream>
#include <ifaddrs.h>
#include <linux/if_packet.h>
#include <net/if.h>
#include <sstream>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/sysinfo.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/utsname.h>
#include <unistd.h>

namespace rnlinux::deviceinfo {

namespace {

// Slurp a small text file. Returns an empty string if the file is
// missing — sysfs entries we read here either exist (when the kernel
// surface is available) or don't, and we want a missing surface to
// degrade to "" rather than throw.
std::string slurp(const char* path) {
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

// /etc/os-release is a KEY="VALUE" file. Parse it once.
std::string osReleaseField(const std::string& body, const std::string& key) {
  // Match `KEY=` at start-of-line; value may be unquoted, single- or
  // double-quoted. Tiny hand-rolled parser; pulling regex in here for
  // a few fields would inflate compile times.
  size_t pos = 0;
  while (pos < body.size()) {
    size_t eol = body.find('\n', pos);
    if (eol == std::string::npos)
      eol = body.size();
    if (body.compare(pos, key.size(), key) == 0 && pos + key.size() < body.size() &&
        body[pos + key.size()] == '=') {
      std::string v = body.substr(pos + key.size() + 1, eol - pos - key.size() - 1);
      if (!v.empty() && (v.front() == '"' || v.front() == '\'')) {
        if (v.back() == v.front())
          v = v.substr(1, v.size() - 2);
      }
      return v;
    }
    pos = eol + 1;
  }
  return {};
}

std::string hostname() {
  char buf[256] = {0};
  if (gethostname(buf, sizeof(buf) - 1) == 0)
    return buf;
  return {};
}

// First non-loopback, non-link-local IPv4. Matches what RN's
// getIpAddress returns on Android/Windows ("primary local address").
std::string primaryIPv4() {
  struct ifaddrs* head = nullptr;
  if (getifaddrs(&head) != 0 || !head)
    return {};
  std::string out;
  for (auto* ifa = head; ifa; ifa = ifa->ifa_next) {
    if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_INET)
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

// MAC of the interface owning `primaryIPv4`. We re-walk because getifaddrs
// returns AF_PACKET entries separately and we want the link-layer addr
// matched to the same interface name.
std::string primaryMac() {
  struct ifaddrs* head = nullptr;
  if (getifaddrs(&head) != 0 || !head)
    return {};
  // First pass: find the iface name carrying the primary v4.
  std::string ifname;
  for (auto* ifa = head; ifa; ifa = ifa->ifa_next) {
    if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_INET)
      continue;
    if (!(ifa->ifa_flags & IFF_UP) || (ifa->ifa_flags & IFF_LOOPBACK))
      continue;
    ifname = ifa->ifa_name;
    break;
  }
  std::string out;
  if (!ifname.empty()) {
    for (auto* ifa = head; ifa; ifa = ifa->ifa_next) {
      if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_PACKET)
        continue;
      if (ifname != ifa->ifa_name)
        continue;
      auto* sll = reinterpret_cast<sockaddr_ll*>(ifa->ifa_addr);
      char buf[18];
      std::snprintf(buf,
                    sizeof(buf),
                    "%02x:%02x:%02x:%02x:%02x:%02x",
                    sll->sll_addr[0],
                    sll->sll_addr[1],
                    sll->sll_addr[2],
                    sll->sll_addr[3],
                    sll->sll_addr[4],
                    sll->sll_addr[5]);
      out = buf;
      break;
    }
  }
  freeifaddrs(head);
  return out;
}

// First /dev/video* node — good enough for the "is there a camera"
// signal RN's isCameraPresent() conveys. The actual camera might not
// be accessible (perms, busy), but the device node existing matches
// what desktop libraries (gstreamer's v4l2 probe) check.
bool hasV4l2Camera() {
  for (int i = 0; i < 8; ++i) {
    char path[32];
    std::snprintf(path, sizeof(path), "/dev/video%d", i);
    struct stat st;
    if (stat(path, &st) == 0)
      return true;
  }
  return false;
}

// RN's isEmulator() is a "running under a VM/emulator" check. On
// Linux DMI sys_vendor / product_name exposes the hypervisor when
// running guest. VMware/QEMU/KVM/VirtualBox/Hyper-V/Parallels all set
// one of these strings; matching any of them is reliable enough for
// the contract callers expect (analytics, fraud signals, "skip the
// expensive feature on simulator").
bool detectEmulator(const std::string& vendor, const std::string& product) {
  static const char* kEmuMarkers[] = {"QEMU",
                                      "Bochs",
                                      "KVM",
                                      "VMware",
                                      "VirtualBox",
                                      "Xen",
                                      "innotek",
                                      "Hyper",
                                      "Microsoft Corporation",
                                      "Parallels",
                                      "Apple Virtualization",
                                      nullptr};
  for (int i = 0; kEmuMarkers[i]; ++i) {
    if (vendor.find(kEmuMarkers[i]) != std::string::npos)
      return true;
    if (product.find(kEmuMarkers[i]) != std::string::npos)
      return true;
  }
  return false;
}

PowerState readPowerState() {
  PowerState ps;
  // Walk /sys/class/power_supply/* and pick the first battery (Type=Battery).
  // Most laptops have just BAT0; we don't aggregate multiple batteries.
  DIR* d = opendir("/sys/class/power_supply");
  if (!d)
    return ps;
  struct dirent* ent;
  while ((ent = readdir(d))) {
    if (ent->d_name[0] == '.')
      continue;
    std::string base = std::string("/sys/class/power_supply/") + ent->d_name;
    std::string type = slurp((base + "/type").c_str());
    if (type != "Battery")
      continue;
    std::string cap = slurp((base + "/capacity").c_str());
    std::string status = slurp((base + "/status").c_str());
    if (!cap.empty()) {
      try {
        ps.batteryLevel = std::stod(cap) / 100.0;
      } catch (...) {
      }
    }
    if (status == "Charging" || status == "Full" || status == "Discharging" ||
        status == "Not charging") {
      // RN normalizes: charging | discharging | full | unknown
      if (status == "Charging")
        ps.batteryState = "charging";
      else if (status == "Discharging" || status == "Not charging")
        ps.batteryState = "discharging";
      else
        ps.batteryState = "full";
    }
    // lowPowerMode signal: the kernel's capacity_level enum
    // ("Critical" / "Low" / "Normal" / "High" / "Full" / "Unknown")
    // is the most portable. UPower derives WarningLevel from the
    // same source; we use it directly to avoid a DBus round-trip.
    // "Low" and "Critical" both flip lowPowerMode true so expo
    // apps that switch to low-power behaviour kick in early
    // enough to matter.
    std::string capLevel = slurp((base + "/capacity_level").c_str());
    if (capLevel == "Low" || capLevel == "Critical") {
      ps.lowPowerMode = true;
    }
    break;
  }
  closedir(d);
  // Fallback for desktops/laptops without a capacity_level node
  // (some firmware doesn't expose it): treat <= 15% as low power
  // when discharging — matches the iOS heuristic users expect.
  if (!ps.lowPowerMode && ps.batteryLevel >= 0.0 && ps.batteryLevel <= 0.15 &&
      ps.batteryState == "discharging") {
    ps.lowPowerMode = true;
  }
  // Per-distro "platform profile" knob (e.g. on framework laptops,
  // gnome power-profiles-daemon, fwupd). When the platform is
  // explicitly set to "low-power", honor that even if the battery
  // is full — the user asked for it.
  std::string profile = slurp("/sys/firmware/acpi/platform_profile");
  if (profile == "low-power") {
    ps.lowPowerMode = true;
  }
  return ps;
}

int64_t readMemTotal() {
  std::ifstream f("/proc/meminfo");
  std::string key;
  while (f >> key) {
    if (key == "MemTotal:") {
      int64_t kb = 0;
      f >> kb;
      return kb * 1024;
    }
    std::string rest;
    std::getline(f, rest);
  }
  return 0;
}

int64_t readSelfRss() {
  std::ifstream f("/proc/self/status");
  std::string key;
  while (f >> key) {
    if (key == "VmRSS:") {
      int64_t kb = 0;
      f >> kb;
      return kb * 1024;
    }
    std::string rest;
    std::getline(f, rest);
  }
  return 0;
}

// Walk /sys/class/input/event*/device/name and look for a keyboard.
// EV_KEY-capable devices in /proc/bus/input/devices would be more
// accurate but require root or a parse pass; the heuristic below is
// good enough for the "we have a HW keyboard" signal RN callers use.
bool hasInputClass(const char* substr) {
  std::ifstream f("/proc/bus/input/devices");
  if (!f.is_open())
    return false;
  std::string line;
  while (std::getline(f, line)) {
    if (line.find(substr) != std::string::npos)
      return true;
  }
  return false;
}

int64_t timeOfDayMs() {
  struct timeval tv;
  if (gettimeofday(&tv, nullptr) != 0)
    return 0;
  return static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

int64_t selfStartTimeMs() {
  // /proc/self/stat field 22 (starttime) = clock ticks since boot.
  // Convert via _SC_CLK_TCK + system boot time.
  std::ifstream f("/proc/self/stat");
  std::string raw;
  std::getline(f, raw);
  // Skip past comm — it can contain spaces/parens.
  size_t close = raw.rfind(')');
  if (close == std::string::npos)
    return 0;
  std::istringstream is(raw.substr(close + 1));
  std::string tok;
  // After the close-paren we have state + 19 more fields; starttime is the 22nd
  // overall, which is the 20th from here.
  for (int i = 0; i < 20; ++i)
    is >> tok;
  int64_t ticks = 0;
  is >> ticks;
  long hz = sysconf(_SC_CLK_TCK);
  if (hz <= 0)
    return 0;
  // Read /proc/stat for boot time.
  std::ifstream s("/proc/stat");
  std::string line;
  int64_t btime = 0;
  while (std::getline(s, line)) {
    if (line.rfind("btime ", 0) == 0) {
      btime = std::stoll(line.substr(6));
      break;
    }
  }
  if (btime == 0)
    return 0;
  return (btime * 1000) + (ticks * 1000 / hz);
}

} // namespace

DeviceInfo gather() {
  DeviceInfo d;

  // ─ DMI (motherboard / vendor) ──────────────────────────────────
  d.brand = slurp("/sys/class/dmi/id/sys_vendor");
  d.manufacturer = d.brand;
  d.model = slurp("/sys/class/dmi/id/product_name");
  d.deviceId = d.model;
  d.serialNumber = slurp("/sys/class/dmi/id/product_serial");
  d.bootloader = slurp("/sys/class/dmi/id/bios_vendor");

  // ─ kernel / uname ──────────────────────────────────────────────
  struct utsname uts;
  if (uname(&uts) == 0) {
    d.systemVersion = uts.release;
    d.buildId = uts.release;
    d.hardware = uts.machine;
    d.host = uts.nodename;
    d.supportedAbis.push_back(uts.machine);
  }

  // ─ hostname / network ─────────────────────────────────────────
  d.deviceName = hostname();
  if (d.host.empty())
    d.host = d.deviceName;
  if (!d.host.empty())
    d.hostNames.push_back(d.host);
  d.ipAddress = primaryIPv4();
  d.macAddress = primaryMac();

  // ─ os-release (distribution) ──────────────────────────────────
  {
    auto body = slurp("/etc/os-release");
    if (body.empty())
      body = slurp("/usr/lib/os-release");
    d.product = osReleaseField(body, "ID");
    d.codename = osReleaseField(body, "VERSION_CODENAME");
    d.display = osReleaseField(body, "PRETTY_NAME");
  }

  // ─ /etc/machine-id (stable per install) ────────────────────────
  d.uniqueId = slurp("/etc/machine-id");
  if (d.uniqueId.empty())
    d.uniqueId = slurp("/var/lib/dbus/machine-id");
  d.instanceId = d.uniqueId;

  // ─ self process ───────────────────────────────────────────────
  // /proc/self/comm is capped at TASK_COMM_LEN (15 chars). Read
  // /proc/self/cmdline for the full executable name — fields are
  // NUL-separated, argv[0] is what we want.
  {
    std::ifstream cmd("/proc/self/cmdline", std::ios::binary);
    std::string raw((std::istreambuf_iterator<char>(cmd)), std::istreambuf_iterator<char>());
    const size_t nul = raw.find('\0');
    const std::string argv0 = (nul == std::string::npos) ? raw : raw.substr(0, nul);
    const size_t slash = argv0.find_last_of('/');
    d.applicationName = slash == std::string::npos ? argv0 : argv0.substr(slash + 1);
    if (d.applicationName.empty())
      d.applicationName = slurp("/proc/self/comm");
  }
  // Bundle id: use the rDNS-style id the playground main.cpp picks.
  // For library use, callers usually set this themselves; until then
  // we mirror applicationName so the field is non-empty.
  d.bundleId = d.applicationName;
  d.startupTime = selfStartTimeMs();
  if (d.startupTime > 0)
    d.firstInstallTime = d.startupTime;

  // ─ fingerprint (Android-style "vendor:product:kernel") ────────
  if (!d.brand.empty() || !d.model.empty() || !d.systemVersion.empty()) {
    d.fingerprint = d.brand + "/" + d.model + "/" + d.systemVersion;
  }

  // ─ emulator detection ─────────────────────────────────────────
  d.isEmulator = detectEmulator(d.brand, d.model);

  // ─ dynamic snapshot ───────────────────────────────────────────
  d.totalMemory = readMemTotal();
  d.maxMemory = d.totalMemory;
  d.usedMemory = readSelfRss();
  struct statvfs st;
  if (statvfs("/", &st) == 0) {
    d.totalDiskCapacity = static_cast<int64_t>(st.f_blocks) * st.f_frsize;
    d.freeDiskStorage = static_cast<int64_t>(st.f_bavail) * st.f_frsize;
  }
  d.power = readPowerState();
  d.isBatteryCharging = d.power.batteryState == "charging" || d.power.batteryState == "full";
  d.isCameraPresent = hasV4l2Camera();
  d.isKeyboardConnected = hasInputClass("keyboard") || hasInputClass("Keyboard");
  d.isMouseConnected = hasInputClass("mouse") || hasInputClass("Mouse");

  return d;
}

} // namespace rnlinux::deviceinfo
