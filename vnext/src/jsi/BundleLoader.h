#pragma once

#include <functional>
#include <string>
#include <vector>

namespace rnlinux {

struct BundleLoadResult {
  bool ok = false;
  std::vector<unsigned char> bytes;
  std::string sourceUrl;
  std::string error;
};

// Loads a JS bundle from a file://, http://, or https:// URL and invokes the
// callback (on an unspecified thread) with the result.
//
// MVP implementation should at least support:
//   - file://...    open + read into a vector
//   - http://...    libcurl GET
void loadBundle(std::string url, std::function<void(BundleLoadResult)> callback);

} // namespace rnlinux
