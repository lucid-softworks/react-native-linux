// PlatformConstants — first TurboModule wired through the Linux
// codegen pipeline (commit landing this file). Extends the generated
// `NativePlatformConstantsLinuxSpec` and overrides the single
// `getConstants()` virtual; all JSI dispatch (host function wrappers,
// getPropertyNames, name lookup) is generated.
//
// Source spec: packages/@lucid-softworks/react-native-linux/Libraries/
//   Specs/NativePlatformConstantsLinux.ts
// Generator:   @lucid-softworks/react-native-linux-codegen

#include "react-native-linux/Logging.h"
#include "react-native-linux/TurboModuleRegistry.h"
#include "specs/NativePlatformConstantsLinuxSpec.h"

#include <folly/dynamic.h>
#include <fstream>
#include <string>
#include <sys/utsname.h>

namespace rnlinux {

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

class PlatformConstantsModule final : public codegen::NativePlatformConstantsLinuxSpec {
 public:
  folly::dynamic getConstants() override {
    utsname u{};
    std::string osVersion;
    if (uname(&u) == 0) {
      osVersion = u.release;
    }

    auto distribution = readOsReleaseField("PRETTY_NAME");
    if (distribution.empty())
      distribution = "unknown";
    auto manufacturer = readOsReleaseField("ID");
    if (manufacturer.empty())
      manufacturer = "unknown";

    // RN convention: include the platform name (`OS: "linux"`) so the
    // JS-side `Platform.OS` resolver can fall back here. Not declared
    // in the spec because the JS-side `Platform.linux.js` already
    // pins it; this is belt-and-suspenders for non-standard
    // consumers reading getConstants() directly.
    return folly::dynamic::object //
        ("isTesting", false)      //
        ("reactNativeVersion",
         folly::dynamic::object                   //
         ("major", 0)                             //
         ("minor", 76)                            //
         ("patch", 0)                             //
         ("prerelease", folly::dynamic(nullptr))) //
        ("osVersion", osVersion)                  //
        ("Distribution", distribution)            //
        ("Manufacturer", manufacturer)            //
        ("OS", "linux");
  }
};

// One-shot module registration on first include of this TU. The
// linker pulls this file in via the always-loaded react_native_linux
// shared library, so registration happens before any bundle is
// evaluated and the JS-side TurboModuleRegistry.get can find us.
struct PlatformConstantsRegistration {
  PlatformConstantsRegistration() {
    TurboModuleRegistry::instance().registerModule(
        codegen::NativePlatformConstantsLinuxSpec::kModuleName,
        [](facebook::jsi::Runtime& /*rt*/) -> std::shared_ptr<TurboModule> {
          return std::make_shared<PlatformConstantsModule>();
        });
  }
};
static PlatformConstantsRegistration kRegisterPlatformConstants;

} // namespace

} // namespace rnlinux
