// MetroReloadClient — listens to Metro's HMR/devtools WebSocket and triggers
// host.reload() on the UI thread when Metro broadcasts a `reload` message.
//
// Metro endpoint:  ws://<host>:<port>/message?role=client
// Messages of interest:
//   { "method": "reload" }
//   { "method": "devMenu" }
//
// MVP behavior:
//   - connect on host start (only in __DEV__)
//   - on `reload`, dispatch a reload via g_idle_add → RNLinuxHost::reload()
//
// Implementation strategy: link against libsoup-3.0 (already pulled in
// transitively by GTK4) for its GSocketClient + WebSocket support. Or use a
// header-only lib like `https://github.com/zaphoyd/websocketpp`. TBD.

#include "react-native-linux/Logging.h"

namespace rnlinux {

void startMetroReloadClient(const std::string& metroHost, int metroPort) {
  RNL_LOGI("MetroReload") << "would connect to ws://" << metroHost << ":" << metroPort
                          << "/message?role=client (stub)";
  // TODO: spin up libsoup3 WebSocket connection on background thread.
}

} // namespace rnlinux
