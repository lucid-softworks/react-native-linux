// PlatformConstants — TurboModule implementation backing the
// NativePlatformConstantsLinux spec (Libraries/Specs/NativePlatformConstantsLinux.ts).
//
// Codegen will produce a header NativePlatformConstantsLinuxSpec.h that this
// file should #include and inherit from. Until codegen is wired we keep the
// implementation hand-rolled.

#include "react-native-linux/Logging.h"

#include <sys/utsname.h>

#include <fstream>
#include <sstream>
#include <string>

namespace rnlinux {

struct PlatformConstantsValues {
  bool isTesting;
  int reactNativeMajor;
  int reactNativeMinor;
  int reactNativePatch;
  std::string osVersion;
  std::string distribution;
  std::string manufacturer;
};

namespace {

std::string readOsReleaseField(const std::string& key) {
  std::ifstream f("/etc/os-release");
  std::string line;
  const std::string needle = key + "=";
  while (std::getline(f, line)) {
    if (line.rfind(needle, 0) == 0) {
      auto v = line.substr(needle.size());
      if (!v.empty() && v.front() == '"' && v.back() == '"') {
        v = v.substr(1, v.size() - 2);
      }
      return v;
    }
  }
  return {};
}

}  // namespace

PlatformConstantsValues getPlatformConstants() {
  PlatformConstantsValues v;
  v.isTesting = false;
  v.reactNativeMajor = 0;
  v.reactNativeMinor = 76;
  v.reactNativePatch = 0;

  utsname u{};
  if (uname(&u) == 0) {
    v.osVersion = u.release;
  }
  v.distribution = readOsReleaseField("PRETTY_NAME");
  if (v.distribution.empty()) v.distribution = "unknown";
  v.manufacturer = readOsReleaseField("ID");
  if (v.manufacturer.empty()) v.manufacturer = "unknown";
  return v;
}

}  // namespace rnlinux
