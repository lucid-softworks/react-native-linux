#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <react-native-linux/RNLinuxApplication.h>
#include <react-native-linux/RNLinuxHost.h>
#include <string>

namespace {

std::string envOr(const char* key, std::string fallback) {
  const char* v = std::getenv(key);
  return v ? std::string{v} : std::move(fallback);
}

std::string resolveBundleUrl() {
  // Dev: load from Metro on localhost.
  // Release: load the bundle file shipped alongside the executable.
  if (std::getenv("RN_BUNDLE_URL")) {
    return std::getenv("RN_BUNDLE_URL");
  }
  const auto host = envOr("RN_METRO_HOST", "127.0.0.1");
  const auto port = envOr("RN_METRO_PORT", "8081");
  return "http://" + host + ":" + port + "/index.bundle?platform=linux&dev=true&minify=false";
}

} // namespace

int main(int argc, char** argv) {
  rnlinux::RNLinuxHost::Config cfg;
  cfg.applicationId = "HelloRnLinux";
  cfg.bundleUrl = resolveBundleUrl();
  cfg.windowTitle = "Hello RN Linux";
  cfg.initialWidth = 960;
  cfg.initialHeight = 640;

  std::cout << "[rn-linux-app] bundle url: " << cfg.bundleUrl << '\n';

  rnlinux::RNLinuxApplication app{std::move(cfg)};
  return app.run(argc, argv);
}
