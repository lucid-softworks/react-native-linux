# Real-app harness: expo-battery + expo-sharing

Two small JS-only shims sharing one doc — neither needed new C++.

## expo-battery — reuses the device-info power-state path

The C++ `DeviceInfo::gather()` already reads
`/sys/class/power_supply/*` for the first battery's capacity +
status, so the expo-battery shim just re-shapes that snapshot
into upstream's API. No new native code.

```
JS app
  ↓ require('expo-battery')
@lucid-softworks/.../expo-battery.js
  ├─ getBatteryLevelAsync / getBatteryStateAsync / getPowerStateAsync
  ├─ isLowPowerModeEnabledAsync
  └─ useBatteryLevel / useBatteryState / usePowerState / useLowPowerMode hooks
  ↓
rnLinux.deviceInfoSync()        ← existing JSI binding
  ↓
DeviceInfo::gather()            ← /sys/class/power_supply/*
```

| API                            | Behavior on Linux                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPowerStateAsync()`         | `{batteryLevel, batteryState, lowPowerMode}` from /sys/class/power_supply                                                                                        |
| `getBatteryLevelAsync()`       | 0..1 fraction; `-1` when no battery (desktops, VMs)                                                                                                              |
| `getBatteryStateAsync()`       | `CHARGING / UNPLUGGED / FULL / UNKNOWN` enum                                                                                                                     |
| `isLowPowerModeEnabledAsync()` | Real — `/sys/class/power_supply/BAT*/capacity_level == Low/Critical`, plus a discharging-below-15% fallback and an ACPI `platform_profile == low-power` override |
| `add…Listener` / `use…` hooks  | Real — JS-side 5s poll, fans out on actual change (no spurious ticks)                                                                                            |
| `BatteryState` enum            | Numeric, matches upstream                                                                                                                                        |

**Gaps:** The polling cadence (5s) is fine for the laptop battery
case but won't catch a fast plug-flap inside the interval. A
DBus-backed `org.freedesktop.UPower` subscription would close
that, at the cost of pulling UPower in as a runtime dep.
`lowPowerMode` is wired off the kernel's `capacity_level` enum —
the same signal UPower itself derives `WarningLevel` from — so
a UPower upgrade wouldn't change the value, only the latency.

## expo-sharing — routes through rnLinux.openURL

Linux doesn't have a unified iOS-style share sheet. The closest
common UX is "open this in the default app for its MIME type" —
which is exactly what GIO's `g_app_info_launch_default_for_uri`
does, and exactly what xdg-open does under the hood. We already
have `rnLinux.openURL` from the device-info / linking work; the
shim just gates on it.

```
JS app
  ↓ require('expo-sharing')
@lucid-softworks/.../expo-sharing.js
  └─ shareAsync(url) → rnLinux.openURL(file:// or http:// URI)
                       ↓
                       g_app_info_launch_default_for_uri
                       → xdg-mime handler
```

| API                  | Behavior on Linux                                      |
| -------------------- | ------------------------------------------------------ |
| `isAvailableAsync()` | `true` when `rnLinux.openURL` + `canOpenURL` are bound |
| `shareAsync(url)`    | Real — opens the URL in the default xdg-mime handler   |

**Gaps:** No real **share sheet UI**. iOS shows a horizontal
strip of share targets (Messages, Mail, …); Android shows an app
chooser. Linux's xdg-mime "default handler" is a single
preconfigured app — no chooser dialog unless we route through
xdg-desktop-portal's `org.freedesktop.portal.OpenURI.OpenFile`
(which IS a real picker, but only inside sandboxes that wire the
portal). Adding the portal path is the natural follow-up for
Flatpak / Snap distributions.
