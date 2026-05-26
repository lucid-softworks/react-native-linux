#pragma once

// Locale / region / timezone snapshot for `expo-localization`. Pure
// libc / sysfs reads — no DBus, no daemon, no external setup. The
// values come from LC_*/LANG env vars (parsed to BCP-47),
// nl_langinfo (currency code + decimal/grouping separators), and
// /etc/timezone (IANA name). Derivations (isMetric, isRTL,
// temperatureUnit, measurementSystem) come from a tiny region/script
// lookup table — same heuristics CLDR uses at a fraction of the
// size; revisit when an app needs full CLDR coverage.

#include <string>
#include <vector>

namespace rnlinux::locale {

struct LocaleSnapshot {
  std::string languageTag;            // BCP-47, e.g. "en-US"
  std::string languageCode;           // ISO 639, e.g. "en"
  std::string regionCode;             // ISO 3166, e.g. "US" (may be "")
  std::string scriptCode;             // ISO 15924, e.g. "" (rare on Linux locales)
  std::string currencyCode;           // ISO 4217, e.g. "USD"
  std::string currencySymbol;         // e.g. "$"
  std::string decimalSeparator;       // e.g. "."
  std::string digitGroupingSeparator; // e.g. ","
  bool measuresTemperatureInCelsius = true;
  bool usesMetricSystem = true;
  std::string measurementSystem; // "metric" | "us" | "uk"
  std::string temperatureUnit;   // "celsius" | "fahrenheit"
  bool isRTL = false;
  std::string timezone; // IANA, e.g. "America/Los_Angeles"
  // CLDR-based first day of the week, in expo's numbering:
  // 1=Sunday, 2=Monday, 7=Saturday. Defaults to Monday (ISO-8601)
  // when the region isn't in our table.
  int firstWeekday = 2;
};

// Collect everything we can today. Reads of LC_ALL, LANG, etc. are
// per-call so a runtime locale change (rare on desktop) reflects.
LocaleSnapshot snapshot();

// Locales the user has expressed a preference for, in priority
// order. On Linux this maps to LANGUAGE (':'-separated) with LANG
// as fallback. Each entry is a fresh snapshot keyed off that
// locale; mostly the same shape as the primary one but with the
// languageTag / region etc. overridden.
std::vector<LocaleSnapshot> preferredLocales();

} // namespace rnlinux::locale
