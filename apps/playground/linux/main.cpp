#include <cstdlib>
#include <iostream>
#include <react-native-linux/RNLinuxApplication.h>
#include <react-native-linux/RNLinuxHost.h>
#include <string>
#include <sys/stat.h>

namespace {

std::string envOr(const char* key, std::string fallback) {
  const char* v = std::getenv(key);
  return v ? std::string{v} : std::move(fallback);
}

std::string resolveBundleUrl() {
  std::string url;
  if (const char* override = std::getenv("RN_BUNDLE_URL")) {
    url = override;
  } else {
    const auto host = envOr("RN_METRO_HOST", "127.0.0.1");
    const auto port = envOr("RN_METRO_PORT", "8081");
    url = "http://" + host + ":" + port + "/index.bundle?platform=linux&dev=true&minify=false";
  }
  // For file:// app bundles, prefer the `.hbc` (Hermes bytecode)
  // sibling when it exists — same idiom as the vendor resolver
  // below. Hermes auto-detects the magic header on
  // evaluateJavaScript and skips parse/codegen, so a 36 MB app
  // bundle that takes ~2 minutes to interpret-parse on this VM
  // loads in single-digit seconds when precompiled. The bundler
  // (apps/playground/bundle.mjs + /tmp/akari/__rnlinux__/bundle.mjs)
  // emits both `.bundle` and `.bundle.hbc` next to each other.
  const std::string fileScheme = "file://";
  if (url.rfind(fileScheme, 0) == 0) {
    const auto path = url.substr(fileScheme.size());
    const auto hbc = path + ".hbc";
    struct stat st {};
    if (::stat(hbc.c_str(), &st) == 0) {
      return fileScheme + hbc;
    }
  }
  return url;
}

std::string resolveVendorBundleUrl(const std::string& appBundleUrl) {
  if (const char* override = std::getenv("RN_VENDOR_BUNDLE_URL")) {
    return override;
  }
  // For file:// URLs the convention is: vendor.bundle / vendor.bundle.hbc
  // sit in the same directory as the app bundle. Prefer the .hbc
  // (Hermes bytecode) version when it exists — Hermes auto-detects the
  // bytecode magic header and skips parse/codegen, cutting cold-start
  // JS init time. For http:// (Metro) we don't do the split.
  const std::string fileScheme = "file://";
  if (appBundleUrl.rfind(fileScheme, 0) != 0)
    return {};
  auto path = appBundleUrl.substr(fileScheme.size());
  const auto slash = path.find_last_of('/');
  if (slash == std::string::npos)
    return {};
  const auto dir = path.substr(0, slash + 1);
  const auto hbc = dir + "vendor.bundle.hbc";
  struct stat st {};
  if (::stat(hbc.c_str(), &st) == 0) {
    return fileScheme + hbc;
  }
  return fileScheme + dir + "vendor.bundle";
}

} // namespace

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
