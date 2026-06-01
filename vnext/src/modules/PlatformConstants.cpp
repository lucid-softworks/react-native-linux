// PlatformConstants — first TurboModule wired through the Linux
// codegen pipeline. Extends the generated NativePlatformConstantsLinuxSpec
// and overrides the single getConstants() virtual; all JSI dispatch
// (host function wrappers, getPropertyNames, name lookup) is generated.
//
// As of the typed-structs landing in the codegen, getConstants()
// returns a brace-initialised codegen::GetConstantsResult — no more
// hand-rolled folly::dynamic::object chains. The struct's toDynamic
// helper handles the jsi conversion.
//
// Source spec: packages/@lucid-softworks/react-native-linux/Libraries/
//   Specs/NativePlatformConstantsLinux.ts
// Generator:   @lucid-softworks/react-native-linux-codegen

#include "react-native-linux/Logging.h"
#include "react-native-linux/TurboModuleRegistry.h"
#include "specs/NativePlatformConstantsLinuxSpec.h"

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
  codegen::GetConstantsResult getConstants() override {
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

    return {
        .isTesting = false,
        .reactNativeVersion =
            {
                .major = 0,
                .minor = 76,
                .patch = 0,
                .prerelease = "",
            },
        .osVersion = std::move(osVersion),
        .Distribution = std::move(distribution),
        .Manufacturer = std::move(manufacturer),
        .OS = "linux",
    };
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
