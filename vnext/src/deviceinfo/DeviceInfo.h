#pragma once

// One-shot Linux device-info collector. The JSI binding
// rnLinux.deviceInfoSync() wraps `gather()` and hands a single
// dictionary back to JS, which `runtime/device-info.js` then exposes
// as the `react-native-device-info` surface. We deliberately gather
// the cheap (file-read-only) values up-front and cache; the JS shim
// re-queries dynamic ones (battery / disk / memory) per-call by
// re-invoking the C++ helper.

#include <cstdint>
#include <string>
#include <vector>

namespace rnlinux::deviceinfo {

struct PowerState {
  // 0–1 (or -1 if unknown), matches RN's API.
  double batteryLevel = -1.0;
  // "charging" | "discharging" | "full" | "unknown". RN normalizes
  // these into batteryState; we follow the same vocabulary.
  std::string batteryState = "unknown";
  bool lowPowerMode = false;
};

struct DeviceInfo {
  // ─ static (read once at startup) ──────────────────────────────
  std::string brand;                // /sys/class/dmi/id/sys_vendor
  std::string model;                // /sys/class/dmi/id/product_name
  std::string manufacturer;         // same as brand on Linux
  std::string deviceId;             // product_name (RN uses model id here)
  std::string deviceName;           // hostname
  std::string systemName = "Linux"; // RN convention
  std::string systemVersion;        // kernel release (uname -r)
  std::string buildId;              // kernel release
  std::string baseOs = "Linux";
  std::string product;     // os-release ID (ubuntu, fedora…)
  std::string codename;    // os-release VERSION_CODENAME
  std::string display;     // os-release PRETTY_NAME
  std::string fingerprint; // sys_vendor + product_name + kernel
  std::string hardware;    // CPU model (first line of cpuinfo)
  std::string host;        // hostname
  std::vector<std::string> hostNames;
  std::string bootloader;      // /sys/firmware/efi or BIOS marker
  std::string serialNumber;    // /sys/class/dmi/id/product_serial
  std::string uniqueId;        // /etc/machine-id
  std::string instanceId;      // /etc/machine-id (same on Linux)
  std::string applicationName; // /proc/self/comm
  std::string bundleId;        // arg0 basename
  std::string installerPackageName = "linux";
  std::string version = "1.0.0"; // static; apps override
  std::string buildNumber = "1"; // static; apps override
  std::string ipAddress;         // first non-loopback v4
  std::string macAddress;        // first non-loopback v4 iface MAC
  std::string carrier;           // n/a on desktop
  std::vector<std::string> supportedAbis;
  bool isTablet = false;
  bool isEmulator = false; // QEMU / VMware / KVM detect via DMI
  bool hasNotch = false;
  bool hasDynamicIsland = false;
  // 0 = unknown / placeholder. RN APIs that return -1 for unsupported
  // surfaces (e.g. preview SDK, font scale on web) match this convention.
  int apiLevel = 0;
  double fontScale = 1.0;
  // Times — RN returns ms-epoch.
  int64_t firstInstallTime = 0;
  int64_t lastUpdateTime = 0;
  int64_t startupTime = 0;

  // ─ dynamic (refreshed per call) ───────────────────────────────
  int64_t totalMemory = 0;     // bytes (MemTotal)
  int64_t maxMemory = 0;       // bytes (MemTotal — RN uses this on android JVM heap)
  int64_t usedMemory = 0;      // bytes (rss of this proc)
  int64_t freeDiskStorage = 0; // bytes (statvfs root)
  int64_t totalDiskCapacity = 0;
  PowerState power;
  bool isCameraPresent = false;    // /dev/video* exists
  bool isLandscape = false;        // window width > height
  bool isKeyboardConnected = true; // desktop = yes
  bool isMouseConnected = true;
  bool isBatteryCharging = false;
};

// Populate every field. Cheap — single-shot file reads. Safe to call
// from any thread (read-only sysfs / /proc access).
DeviceInfo gather();

} // namespace rnlinux::deviceinfo
