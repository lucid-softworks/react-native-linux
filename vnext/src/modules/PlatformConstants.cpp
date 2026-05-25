// PlatformConstants — first real TurboModule, registered under the
// name "PlatformConstants" so JS code does:
//
//   import {TurboModuleRegistry} from 'react-native';
//   const c = TurboModuleRegistry.getEnforcing('PlatformConstants').getConstants();
//
// The previous ad-hoc rnLinux.platformConstants binding is replaced
// by this. Modules using the spec-codegen flow (none yet on Linux,
// since codegen lacks a linux generator) would slot in via the same
// registry.

#include "react-native-linux/Logging.h"
#include "react-native-linux/TurboModuleRegistry.h"

#include <fstream>
#include <sstream>
#include <string>
#include <sys/utsname.h>

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

PlatformConstantsValues collectConstants() {
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
  if (v.distribution.empty())
    v.distribution = "unknown";
  v.manufacturer = readOsReleaseField("ID");
  if (v.manufacturer.empty())
    v.manufacturer = "unknown";
  return v;
}

class PlatformConstantsModule : public TurboModule {
 public:
  facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                           const facebook::jsi::PropNameID& nameId) override {
    const auto name = nameId.utf8(rt);
    if (name == "getConstants") {
      return facebook::jsi::Function::createFromHostFunction(
          rt,
          facebook::jsi::PropNameID::forUtf8(rt, "getConstants"),
          0,
          [](facebook::jsi::Runtime& rt,
             const facebook::jsi::Value&,
             const facebook::jsi::Value*,
             size_t) -> facebook::jsi::Value {
            const auto v = collectConstants();
            facebook::jsi::Object obj(rt);
            obj.setProperty(rt, "isTesting", facebook::jsi::Value(v.isTesting));
            obj.setProperty(rt, "reactNativeVersion", [&]() {
              facebook::jsi::Object ver(rt);
              ver.setProperty(rt, "major", facebook::jsi::Value(v.reactNativeMajor));
              ver.setProperty(rt, "minor", facebook::jsi::Value(v.reactNativeMinor));
              ver.setProperty(rt, "patch", facebook::jsi::Value(v.reactNativePatch));
              return ver;
            }());
            obj.setProperty(
                rt, "osVersion", facebook::jsi::String::createFromUtf8(rt, v.osVersion));
            obj.setProperty(
                rt, "distribution", facebook::jsi::String::createFromUtf8(rt, v.distribution));
            obj.setProperty(
                rt, "manufacturer", facebook::jsi::String::createFromUtf8(rt, v.manufacturer));
            // RN convention: include the platform name so JS-side
            // detection (Platform.OS) can fall back here.
            obj.setProperty(rt, "OS", facebook::jsi::String::createFromUtf8(rt, "linux"));
            return obj;
          });
    }
    return facebook::jsi::Value::undefined();
  }

  std::vector<facebook::jsi::PropNameID> getPropertyNames(facebook::jsi::Runtime& rt) override {
    std::vector<facebook::jsi::PropNameID> out;
    out.push_back(facebook::jsi::PropNameID::forUtf8(rt, "getConstants"));
    return out;
  }
};

// One-shot module registration on first include of this TU. The
// linker pulls this file in via the always-loaded react_native_linux
// shared library, so registration happens before any bundle is
// evaluated and the JS-side TurboModuleRegistry.get can find us.
struct PlatformConstantsRegistration {
  PlatformConstantsRegistration() {
    TurboModuleRegistry::instance().registerModule(
        "PlatformConstants", [](facebook::jsi::Runtime& /*rt*/) -> std::shared_ptr<TurboModule> {
          return std::make_shared<PlatformConstantsModule>();
        });
  }
};
static PlatformConstantsRegistration kRegisterPlatformConstants;

} // namespace

} // namespace rnlinux
