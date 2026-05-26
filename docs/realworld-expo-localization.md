# Real-app harness: expo-localization via libc + sysfs

`expo-localization` is wired against pure libc and sysfs reads —
no daemon, no DBus, no external setup. Everything comes from
LC\_\*/LANG environment, `nl_langinfo(3)`, `/etc/timezone`, and a
small CLDR-equivalent region table that handles the
metric/imperial, RTL, and temperature-unit derivations.

## Architecture

```
JS app
  ↓ require('expo-localization')   ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-localization.js
  ├─ locale / locales / region / currency / timezone / etc.
  │    ← snapshotted once from rnLinux.localeSnapshot() at import
  ├─ getLocales() → rnLinux.localePreferred()
  └─ getCalendars() — gregorian + real timezone (no per-locale
                       calendar pref signal on Linux desktops)
  ↓
vnext/src/jsi/RnLinuxBindings.cpp                ← JSI bindings
  ↓
vnext/src/locale/Locale.cpp
  ├─ LC_ALL → LC_MESSAGES → LANG  →  parse to BCP-47
  │     (C / C.UTF-8 / POSIX → en/US fallback, case-insensitive)
  ├─ newlocale + uselocale + nl_langinfo
  │     → INT_CURR_SYMBOL  (currency)
  │     → CURRENCY_SYMBOL  (symbol)
  │     → RADIXCHAR        (decimal separator)
  │     → THOUSEP          (grouping separator)
  ├─ /etc/timezone | readlink /etc/localtime | $TZ
  └─ Region tables → metric/us/uk + celsius/fahrenheit + RTL flag
```

The native side uses `newlocale` + `uselocale` so an
`nl_langinfo` query against an arbitrary locale doesn't mutate the
process's `LC_*` globals — multiple snapshots can coexist safely.

## VM / host setup

Nothing to install. Everything is libc.

If you want non-default values (real currency, locale-specific
separators), the system needs the requested locale generated:

```sh
sudo locale-gen en_US.UTF-8 fr_FR.UTF-8   # whichever you need
sudo update-locale
```

Lima dev VMs often only have `C.UTF-8` generated, which is why the
playground's snapshot shows `currency=(none)` even though the
region is correctly derived to `US`. Generating a real locale
populates the `nl_langinfo` fields.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The `expo-localization` section dumps every populated field. With
no real locale generated and the VM in UK timezone, you'd see:

```
locale = en-US
locales = ["en-US"]
region = US  currency = (none)
decimal = "."  grouping = ","
measurement = us  temperature = fahrenheit
timezone = Europe/London  isRTL = false
calendars = gregory
```

## API surface

| API                                                                                      | Behavior on Linux                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `locale` (top-level)                                                                     | BCP-47 from LC_MESSAGES / LANG; `en-US` for POSIX                                  |
| `locales` (top-level)                                                                    | Parsed from `LANGUAGE` (`:`-separated); falls back to `[locale]`                   |
| `region`                                                                                 | ISO 3166 from locale; `null` when bare like `de`                                   |
| `currency`                                                                               | ISO 4217 from `nl_langinfo(INT_CURR_SYMBOL)`; `null` for POSIX                     |
| `decimalSeparator` / `digitGroupingSeparator`                                            | `nl_langinfo(RADIXCHAR / THOUSEP)`                                                 |
| `measurementSystem`                                                                      | `metric` / `us` / `uk` from a small region table                                   |
| `temperatureUnit`                                                                        | `celsius` everywhere except US + Bahamas/Belize/Cayman/Palau/etc.                  |
| `timezone`                                                                               | IANA from `$TZ`, `/etc/timezone`, or `readlink /etc/localtime`                     |
| `isRTL`                                                                                  | True for `ar/fa/he/iw/ur/yi/ps/sd/ug`                                              |
| `isMetric`                                                                               | Inverse of `measurementSystem === 'us'`                                            |
| `getLocales()`                                                                           | Real — full snapshot per preferred locale, in LANGUAGE order                       |
| `getCalendars()`                                                                         | Always `[{calendar: 'gregory', timeZone, uses24hourClock: true, firstWeekday: 2}]` |
| `useLocales` / `useCalendars` hooks                                                      | Real — re-render on `/etc/locale.conf` / `/etc/default/locale` GFileMonitor ticks  |
| `getLocalizationAsync()`                                                                 | Promise-wrapped legacy object                                                      |
| `Calendar` / `TextDirection` / `MeasurementSystem` / `TemperatureUnit` / `Weekday` enums | Match upstream string/numeric values                                               |

## Known gaps

- **`nl_langinfo` only returns data for generated locales.** Bare
  dev VMs with only `C.UTF-8` get the en/US region fallback but
  `currency=null` — `nl_langinfo(INT_CURR_SYMBOL)` returns empty.
  Real desktops with the locale archive populated work fully.
- **Calendar preference detection isn't possible** on bare Linux.
  GNOME's `org.gnome.desktop.calendar.show-weekdate` and friends
  exist via GSettings but cover layout, not the underlying calendar
  system. We always report `gregory` — apps that need
  buddhist/persian/hebrew/etc. should let the user pick in their
  settings rather than auto-detect.
- **`firstWeekday`** — **DONE.** Per-region CLDR table baked into
  the native snapshot: 1=Sunday across the Americas + East Asia
  - much of South/Southeast Asia, 7=Saturday across the Arabian
    peninsula, 2=Monday everywhere else (ISO-8601 default).
    `getCalendars()` plumbs this through, so a fr-CA locale reports
    Sunday and an ar-EG locale reports Saturday without any app
    config.
- **Live subscription** to locale changes — **DONE.** A pair of
  GFileMonitors on `/etc/locale.conf` (freedesktop /
  systemd-localed) and `/etc/default/locale` (Debian / Ubuntu)
  fires on `localectl set-locale` from any shell. The JS shim
  fans the trampoline out via a tick counter that
  `useLocales()` / `useCalendars()` depend on, so they
  re-render with the fresh snapshot. Session-restart is still
  required for the underlying libc state to change, but the app
  notices immediately.
