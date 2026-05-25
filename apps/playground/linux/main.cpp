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

std::string resolveVendorBundleUrl(const std::string& appBundleUrl) {
  if (const char* override = std::getenv("RN_VENDOR_BUNDLE_URL")) {
    return override;
  }
  // For file:// URLs the convention is: vendor.bundle sits in the same
  // directory as the app bundle. For http:// (Metro), no vendor split —
  // Metro serves a single bundle.
  const std::string fileScheme = "file://";
  if (appBundleUrl.rfind(fileScheme, 0) != 0) return {};
  auto path = appBundleUrl.substr(fileScheme.size());
  const auto slash = path.find_last_of('/');
  if (slash == std::string::npos) return {};
  return fileScheme + path.substr(0, slash + 1) + "vendor.bundle";
}

}  // namespace

int main(int argc, char** argv) {
  rnlinux::RNLinuxHost::Config cfg;
  cfg.applicationId = "works.lucidsoft.RNLinuxPlayground";
  cfg.bundleUrl = resolveBundleUrl();
  cfg.vendorBundleUrl = resolveVendorBundleUrl(cfg.bundleUrl);
  cfg.windowTitle = "RN-Linux Playground";
  cfg.initialWidth = 1024;
  cfg.initialHeight = 720;

  std::cout << "[playground] vendor: " << cfg.vendorBundleUrl << '\n';
  std::cout << "[playground] app:    " << cfg.bundleUrl << '\n';

  rnlinux::RNLinuxApplication app{std::move(cfg)};
  return app.run(argc, argv);
}
