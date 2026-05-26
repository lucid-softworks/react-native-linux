# Real-app harness: expo-location via GeoClue2

`expo-location` is wired up against the system's GeoClue2 daemon — the same
location bus GNOME, Phosh, Firefox and friends use on Linux. This isn't a
JS mock: `getCurrentPositionAsync` returns actual coordinates from whichever
source GeoClue can find (a static file, NMEA, modem GPS, WiFi geolocation if
wired).

## Architecture

```
JS app
  ↓ require('expo-location')        ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-location.js
  ↓ rnLinux.locationStartWatch(onFix, onErr)
vnext/src/jsi/RnLinuxBindings.cpp   ← JSI binding
  ↓
vnext/src/location/Location.cpp     ← LocationClient
  ↓ GDBus (system bus)
org.freedesktop.GeoClue2            ← GeoClue daemon
  ↓ LocationUpdated signal
```

The native side keeps a single GeoClue2 client; the JS shim multiplexes
multiple `watchPositionAsync` / `getCurrentPositionAsync` subscribers on top
with reference counting (so the GeoClue client starts on the first subscriber
and stops on the last).

## VM / host setup

These steps run **once** on the machine that actually executes the playground.
Lima dev VMs need them too — the host's `apt install geoclue-2.0` ships the
daemon, the demo agent, and the systemd unit, but it leaves application
authorization opt-in.

### 1. Install GeoClue2

```sh
sudo apt install -y geoclue-2.0
```

### 2. Whitelist the app's DesktopId

The playground binary identifies itself as `rn-linux-playground` to GeoClue
(set via the `DesktopId` property on the client). Without a whitelist entry
the daemon will block on the authorization agent indefinitely.

Append to `/etc/geoclue/geoclue.conf`:

```ini
[rn-linux-playground]
allowed=true
system=true
users=
```

`system=true` lets the demo agent auto-authorize without prompting. Your own
app would substitute its own desktop id.

### 3. Provide a location source (optional but recommended)

In a Lima VM there are no WiFi adapters or modems to lock onto, and Mozilla
Location Service was shut down in mid-2024 — so the default WiFi backend
returns nothing. The simplest deterministic source is `/etc/geolocation`:

```sh
sudo tee /etc/geolocation <<'EOF'
37.7749
-122.4194
16.0
20.0
EOF
```

Four floats: latitude, longitude, altitude (m), accuracy (m). The
`[static-source]` section in `geoclue.conf` is enabled by default; restart
the daemon to pick the file up:

```sh
sudo systemctl restart geoclue.service
```

### 4. (Auto) the GeoClue authorization agent

GeoClue's `Start()` blocks until an authorization agent registers via
`Manager.AddAgent`. Desktop sessions auto-start `geoclue-demo-agent` through
XDG autostart; **bare** sessions (Lima VNC + Xfce, headless, CI) don't, and
this is the trap that hangs early bring-up.

The native `LocationClient` handles this automatically: on the first
`startWatch`, it scans `/proc` for the demo agent binary, and forks+execs it
if missing. No manual intervention needed once `geoclue-2.0` is installed.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

Scroll to the `expo-location` section. The probe row shows
`perms=granted services=on`; the demo below auto-fetches on mount and
renders `lat=… lon=… accuracy=…m altitude=…m`.

## API surface

The shim mirrors the full upstream surface so consumers don't have to
platform-branch. Where Linux has no equivalent the behavior degrades
predictably:

| API                                           | Behavior on Linux                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `requestForegroundPermissionsAsync`           | Returns `granted` — authorization is config-driven, not per-call        |
| `requestBackgroundPermissionsAsync`           | Same — no app-state gate on desktop                                     |
| `hasServicesEnabledAsync`                     | Pings GeoClue's bus name; true if installed and the daemon is reachable |
| `getCurrentPositionAsync`                     | One-shot fix from GeoClue (start → first signal → stop)                 |
| `watchPositionAsync`                          | Subscribes to `LocationUpdated`; returns `{remove()}`                   |
| `getLastKnownPositionAsync`                   | Returns `null` (no native cache yet)                                    |
| `watchHeadingAsync` / `getHeadingAsync`       | No-op subscription / zeroed heading — no compass on desktop             |
| `geocodeAsync` / `reverseGeocodeAsync`        | Returns `[]` — upstream uses Apple/Google services we don't bundle      |
| `startLocationUpdatesAsync` (background task) | No-op                                                                   |
| `startGeofencingAsync`                        | No-op                                                                   |
| `Accuracy` / `PermissionStatus` enums         | Numeric values match upstream                                           |

## Known gaps

- **Heading** isn't wired. GeoClue surfaces a `Heading` field on Location
  objects but no consumer-grade Linux desktop produces it (it's for vehicle
  GPS / phones). `getHeadingAsync` returns zeros.
- **Geocoding / reverse-geocoding** is unimplemented. Upstream `expo-location`
  uses platform APIs that themselves call out to Apple / Google. Doing the
  same on Linux would need a Nominatim or similar HTTP client; out of scope
  for the smoke demo.
- **Background tasks** are stubbed. There's no expo-task-manager equivalent
  on the Linux side yet.
- **Last-known position cache** would be a small JSON file under
  `XDG_CACHE_HOME`, written on each fix. Skipped for the first pass.
