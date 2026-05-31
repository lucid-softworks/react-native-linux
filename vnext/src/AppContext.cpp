#include "react-native-linux/AppContext.h"

namespace rnlinux {

namespace {
// Default matches the historical AsyncStorage path so first-run
// behavior on a stale dev checkout (without an explicit applicationId)
// stays predictable. RNLinuxApplication overwrites this immediately
// on construction, so production callers always see the consumer's
// value.
std::string g_applicationId = "react-native-linux";
} // namespace

void setApplicationId(std::string id) {
  if (id.empty()) {
    return;
  }
  g_applicationId = std::move(id);
}

const std::string& applicationId() {
  return g_applicationId;
}

} // namespace rnlinux
