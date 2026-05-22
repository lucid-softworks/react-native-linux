#include <cstdlib>
#include <iostream>
#include <string>

#include <react-native-linux/RNLinuxApplication.h>
#include <react-native-linux/RNLinuxHost.h>

namespace {

std::string envOr(const char* key, std::string fallback) {
  const char* v = std::getenv(key);
  return v ? std::string{v} : std::move(fallback);
}

std::string resolveBundleUrl() {
  if (const char* override = std::getenv("RN_BUNDLE_URL")) {
    return override;
  }
  const auto host = envOr("RN_METRO_HOST", "127.0.0.1");
  const auto port = envOr("RN_METRO_PORT", "8081");
  return "http://" + host + ":" + port +
         "/index.bundle?platform=linux&dev=true&minify=false";
}

}  // namespace

int main(int argc, char** argv) {
  rnlinux::RNLinuxHost::Config cfg;
  cfg.applicationId = "works.lucidsoft.RNLinuxPlayground";
  cfg.bundleUrl = resolveBundleUrl();
  cfg.windowTitle = "RN-Linux Playground";
  cfg.initialWidth = 1024;
  cfg.initialHeight = 720;

  std::cout << "[playground] bundle url: " << cfg.bundleUrl << '\n';

  rnlinux::RNLinuxApplication app{std::move(cfg)};
  return app.run(argc, argv);
}
