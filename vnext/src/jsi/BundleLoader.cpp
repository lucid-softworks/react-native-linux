#include "BundleLoader.h"

#include "react-native-linux/Logging.h"

#include <filesystem>
#include <fstream>
#include <thread>

namespace rnlinux {

namespace {

bool startsWith(std::string_view s, std::string_view prefix) {
  return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

BundleLoadResult loadFile(std::string url) {
  BundleLoadResult r;
  r.sourceUrl = url;
  auto path = url.substr(std::string_view("file://").size());
  std::error_code ec;
  if (!std::filesystem::exists(path, ec)) {
    r.error = "bundle file not found: " + path;
    return r;
  }
  std::ifstream f(path, std::ios::binary);
  if (!f) {
    r.error = "failed to open " + path;
    return r;
  }
  r.bytes.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
  r.ok = true;
  return r;
}

BundleLoadResult loadHttp(std::string url) {
  // TODO: use libcurl or libsoup3 (since GTK4 already brings it in
  // transitively on most distros). For MVP we stub this out and report a
  // clear error.
  BundleLoadResult r;
  r.sourceUrl = url;
  r.error = "HTTP bundle loading not yet implemented. Either bundle to disk with "
            "`react-native bundle-linux` or wire libcurl into BundleLoader.cpp.";
  return r;
}

} // namespace

void loadBundle(std::string url, std::function<void(BundleLoadResult)> callback) {
  std::thread([url = std::move(url), cb = std::move(callback)]() mutable {
    BundleLoadResult result;
    if (startsWith(url, "file://")) {
      result = loadFile(url);
    } else if (startsWith(url, "http://") || startsWith(url, "https://")) {
      result = loadHttp(url);
    } else {
      result.error = "unsupported bundle URL scheme: " + url;
    }
    if (!result.ok) {
      RNL_LOGE("BundleLoader") << result.error;
    }
    cb(std::move(result));
  }).detach();
}

} // namespace rnlinux
