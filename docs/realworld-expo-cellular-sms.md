# Real-app harness: expo-cellular + expo-sms (honest "no telephony" shims)

Both `expo-cellular` and `expo-sms` are telephony APIs — they assume
a device with a SIM card and cellular modem. Desktop Linux has neither,
so these shims return honest "no hardware" responses rather than faking
success.

## Why one doc for both

They're thematically coupled (telephony hardware), shimmed in the same
branch, and share the same design principle: match upstream's own
behavior on unsupported platforms (web / simulator / iPod touch).

## Design principle: match upstream's unsupported-platform behavior

Upstream Expo already handles "no telephony" on iOS simulators and web.
Our shims return the same values those platforms do — cross-platform
code that handles the "no SIM" path already works correctly without
any Linux-specific logic.

**expo-cellular** uses the "null data" pattern:
- Data getters (`getCarrierNameAsync`, `getMobileCountryCodeAsync`,
  etc.) return `null` — the same as iOS on a device with no SIM.
- `getCellularGenerationAsync()` returns `CellularGeneration.UNKNOWN`.
- Permissions return `granted` — there's no phone-state permission
  concept on desktop (matches upstream's non-Android path).

**expo-sms** uses the "unavailable action" pattern:
- `isAvailableAsync()` returns `false`.
- `sendSMSAsync()` throws `UnavailabilityError` — same error code
  (`ERR_UNAVAILABLE`) that upstream throws on unsupported platforms.

These patterns differ because the APIs differ: cellular is a data-query
API (what generation? what carrier?), while SMS is an action API (send
a message). Returning `null` for "no data" is natural; throwing for
"can't perform action" is natural.

## Architecture

```
JS app
  ↓ require('expo-cellular')   ← metro/esbuild rewrite, linux only
@lucid-softworks/.../expo-cellular.js
  ├─ CellularGeneration enum (UNKNOWN=0 … CELLULAR_5G=4)
  ├─ getCellularGenerationAsync → UNKNOWN
  ├─ getCarrierNameAsync / getMobileCountryCodeAsync / … → null
  ├─ allowsVoipAsync → null
  ├─ getPermissionsAsync / requestPermissionsAsync → granted
  └─ usePermissions → [granted, requestFn, getFn]  (3-tuple)

JS app
  ↓ require('expo-sms')
@lucid-softworks/.../expo-sms.js
  ├─ isAvailableAsync → false
  └─ sendSMSAsync → throws UnavailabilityError
```

No native code; no DBus. Both register with `expo-modules-core`
(`ExpoCellular` / `ExpoSMS`) so `globalThis.expo.modules` sees them.

## API surface — expo-cellular

| API                          | Behavior on Linux                             |
| ---------------------------- | --------------------------------------------- |
| `getCellularGenerationAsync` | `CellularGeneration.UNKNOWN` (0)              |
| `allowsVoipAsync`           | `null`                                        |
| `getIsoCountryCodeAsync`    | `null`                                        |
| `getCarrierNameAsync`       | `null`                                        |
| `getMobileCountryCodeAsync` | `null`                                        |
| `getMobileNetworkCodeAsync` | `null`                                        |
| `getPermissionsAsync`       | `{ status: 'granted', granted: true, … }`     |
| `requestPermissionsAsync`   | Same as `getPermissionsAsync`                 |
| `usePermissions`            | `[grantedResponse, requestFn, getFn]` 3-tuple |
| `CellularGeneration` enum   | All 5 values (UNKNOWN through CELLULAR_5G)    |

## API surface — expo-sms

| API                | Behavior on Linux                           |
| ------------------ | ------------------------------------------- |
| `isAvailableAsync` | `false`                                     |
| `sendSMSAsync`     | Throws `UnavailabilityError` (ERR_UNAVAILABLE) |

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The expo-cellular probe shows `gen=0 carrier=null mcc=null perms=granted`.
The expo-sms probe shows `available=false`. Both display captions
explaining that telephony hardware is unavailable on desktop Linux.

## When this might become real

**ModemManager over DBus.** Linux machines with a cellular modem
(5G USB dongles, embedded boards with LTE modules, some Lenovo
ThinkPads with WWAN cards) expose telephony state through
ModemManager's DBus interface (`org.freedesktop.ModemManager1`).
A future implementation could:

- Query `Modem.Modem3gpp` properties for carrier name, MCC, MNC
- Map `AccessTechnologies` flags to `CellularGeneration` values
- Use `Modem.Messaging` for SMS send (making `isAvailableAsync` true)

This would be a meaningful implementation — not a shim — but only
useful for the small subset of Linux devices with cellular hardware.
Until there's user demand, the honest "no telephony" responses are
the right default.
