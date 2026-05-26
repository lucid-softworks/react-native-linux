# Real-app harness: expo-network via GNetworkMonitor + sysfs

`expo-network` is backed by GIO's `GNetworkMonitor` for the binary
"up?" / "internet?" signals and `/sys/class/net` for interface
classification, IP, and MAC. `GNetworkMonitor` auto-selects
NetworkManager when present and falls back to a pure netlink
monitor when not — so this works on Lima dev VMs, headless
servers, and consumer desktops without taking an explicit
dependency on NM.

## Architecture

```
JS app
  ↓ require('expo-network')        ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-network.js
  ├─ getNetworkStateAsync()        →  rnLinux.networkState()
  ├─ getIpAddressAsync()           →  rnLinux.networkState().ipAddress
  ├─ getMacAddressAsync()          →  rnLinux.networkState().macAddress
  ├─ useNetworkState() hook
  └─ addNetworkStateListener()     →  rnLinux.networkSetStateListener (fan-out)
  ↓
vnext/src/jsi/RnLinuxBindings.cpp
  ↓
vnext/src/network/Network.cpp
  ├─ Walk /sys/class/net → first non-loopback iface with operstate=up
  ├─ Classify via name prefix (wl* → WIFI, en*/eth* → ETHERNET,
  │  wwan*/ppp*/rmnet* → CELLULAR, bnep*/pan* → BLUETOOTH,
  │  tun*/tap*/vpn*/wg* → VPN) with /sys/class/net/<iface>/type
  │  as a fallback for unmatched names
  └─ g_network_monitor_get_default()
     → get_network_available     (isConnected)
     → get_connectivity == FULL  (isInternetReachable)
```

## VM / host setup

Nothing. `GNetworkMonitor` is in GIO; we already link it for every
other DBus consumer (geoclue, notifications, secure-store,
keep-awake, file-system).

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The expo-network section auto-fetches state on mount and exposes a
**refresh** button. Probe shows
`type=… connected=true internet=… ip=…`.

## API surface

| API                            | Behavior on Linux                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `getNetworkStateAsync()`       | Real — `{type, isConnected, isInternetReachable}` from GNetworkMonitor + sysfs            |
| `getIpAddressAsync()`          | Real — first non-loopback IPv4 of the active interface                                    |
| `getMacAddressAsync()`         | Real — `/sys/class/net/<iface>/address` of the active interface                           |
| `useNetworkState()` hook       | Real — re-renders on `GNetworkMonitor::network-changed`                                   |
| `addNetworkStateListener()`    | Real — fan-out over the single native trampoline; auto-tears down on last unsubscribe     |
| `isAirplaneModeEnabledAsync()` | Real — `true` iff every wireless rfkill node is soft-blocked (`/sys/class/rfkill/*/soft`) |
| `getCellularGenerationAsync()` | Returns `UNKNOWN` — Android-only concept                                                  |
| `NetworkStateType` enum        | `NONE / UNKNOWN / WIFI / CELLULAR / ETHERNET / BLUETOOTH / VPN / WIMAX / OTHER` (strings) |
| `CellularGeneration` enum      | Exported as numeric constants for cross-platform branching                                |

## Known gaps

- **Live `network-changed` subscription** — **DONE.** A native
  `setStateListener` slot hooks `g_signal_connect(monitor,
"network-changed", ...)` and re-emits the current snapshot on
  the next idle tick. The JS shim multiplexes all consumers
  behind that single slot and tears the subscription down when
  the last listener unsubscribes; `useNetworkState()` rides on
  top so it re-renders on connectivity flips.
- **Interface classification is heuristic.** Name prefixes plus
  `/sys/class/net/<iface>/type` cover the common cases; exotic
  device drivers might fall through to `UNKNOWN`. NetworkManager's
  D-Bus API has authoritative device-type metadata if real apps
  need stronger classification.
- **Per-interface enumeration** — **DONE.** `getInterfacesAsync()`
  (Linux-only extension on the expo-network shim) walks
  `/sys/class/net` and returns `[{name, type, isUp, ipv4, ipv6,
macAddress}]` for every iface the kernel exposes — including
  loopback, VPN tap devices, and bridges. `isUp` is a binary
  flag derived from the kernel's operstate (`up` only; dormant
  counts as down). IPv6 prefers routable addresses over link-
  local `fe80::/10`. Useful for multi-NIC / VPN-aware apps;
  cross-platform code should branch on platform before calling.
- **`isAirplaneModeEnabledAsync`** — **DONE.** Walks
  `/sys/class/rfkill/rfkill*` and returns `true` iff every
  wireless `type` (wlan/bluetooth/wwan/gps/wimax/uwb) has
  `soft == 1`. Hardware blocks (`hard`) aren't required because
  most laptops only toggle soft blocks via the airplane key.
  Returns `false` on systems without rfkill (servers / VMs
  without virtual radios) since the user can't be "in airplane
  mode" on a system that has no radios.
