#include "Locale.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <langinfo.h>
#include <limits.h>
#include <locale.h>
#include <sstream>
#include <unistd.h>

namespace rnlinux::locale {

namespace {

std::string slurp(const char* path) {
  std::ifstream f(path);
  if (!f.is_open())
    return {};
  std::stringstream ss;
  ss << f.rdbuf();
  std::string out = ss.str();
  while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' '))
    out.pop_back();
  return out;
}

// glibc locale strings look like "en_US.UTF-8@modifier" — split
// the language / region (and optionally script in the modifier)
// out into BCP-47 components. We ignore the encoding suffix
// (everything is UTF-8 in practice on modern desktops) and the
// modifier unless it carries a known script tag.
struct ParsedLocale {
  std::string language;
  std::string region;
  std::string script;
};

ParsedLocale parseLocale(const std::string& raw) {
  ParsedLocale out;
  std::string s = raw;
  // Strip encoding suffix (".UTF-8" etc.) before checking for the
  // POSIX sentinel — `C.UTF-8` should land in the en/US fallback
  // exactly like bare `C`.
  auto dot = s.find('.');
  std::string modifier;
  if (dot != std::string::npos) {
    auto at = s.find('@', dot);
    if (at != std::string::npos)
      modifier = s.substr(at + 1);
    s = s.substr(0, dot);
  } else {
    auto at = s.find('@');
    if (at != std::string::npos) {
      modifier = s.substr(at + 1);
      s = s.substr(0, at);
    }
  }
  // Case-insensitive POSIX check — glibc accepts `c`, `C`,
  // `posix`, `POSIX` as the no-locale sentinel.
  auto eqInsensitive = [](const std::string& a, const char* b) {
    if (a.size() != std::strlen(b))
      return false;
    for (size_t i = 0; i < a.size(); ++i)
      if (std::tolower(static_cast<unsigned char>(a[i])) !=
          std::tolower(static_cast<unsigned char>(b[i])))
        return false;
    return true;
  };
  if (s.empty() || eqInsensitive(s, "C") || eqInsensitive(s, "POSIX")) {
    out.language = "en";
    out.region = "US";
    return out;
  }
  // Split lang_REGION.
  auto under = s.find('_');
  if (under != std::string::npos) {
    out.language = s.substr(0, under);
    out.region = s.substr(under + 1);
  } else {
    out.language = s;
  }
  // Lowercase language, uppercase region.
  std::transform(out.language.begin(),
                 out.language.end(),
                 out.language.begin(),
                 [](unsigned char c) { return std::tolower(c); });
  std::transform(out.region.begin(), out.region.end(), out.region.begin(), [](unsigned char c) {
    return std::toupper(c);
  });
  // Modifier carrying a script — rare but `sr@latin` exists.
  if (modifier == "latin")
    out.script = "Latn";
  else if (modifier == "cyrillic")
    out.script = "Cyrl";
  else if (modifier == "devanagari")
    out.script = "Deva";
  return out;
}

std::string buildTag(const ParsedLocale& p) {
  std::string tag = p.language;
  if (!p.script.empty())
    tag += "-" + p.script;
  if (!p.region.empty())
    tag += "-" + p.region;
  return tag.empty() ? "en-US" : tag;
}

// CLDR-equivalent region heuristics. Tiny table — covers what
// users actually notice differing across locales. Anything not
// here defaults to metric / celsius / non-RTL.
bool regionUsesImperial(const std::string& region) {
  static const char* imperial[] = {"US", "LR", "MM", nullptr};
  for (int i = 0; imperial[i]; ++i)
    if (region == imperial[i])
      return true;
  return false;
}

bool regionMixedSystem(const std::string& region) {
  // UK uses metric for most things but imperial for road signs,
  // beer pints, and body weight. CLDR classes it as "uk".
  return region == "GB" || region == "UK";
}

bool regionUsesFahrenheit(const std::string& region) {
  // US is the only major holdout for fahrenheit weather. Some
  // Caribbean nations (BS, BZ, KY, PW) also use F officially.
  static const char* fahrenheitRegions[] = {"US", "BS", "BZ", "KY", "PW", "FM", "MH", nullptr};
  for (int i = 0; fahrenheitRegions[i]; ++i)
    if (region == fahrenheitRegions[i])
      return true;
  return false;
}

bool languageIsRTL(const std::string& lang) {
  static const char* rtl[] = {"ar", "fa", "he", "iw", "ur", "yi", "ps", "sd", "ug", nullptr};
  for (int i = 0; rtl[i]; ++i)
    if (lang == rtl[i])
      return true;
  return false;
}

std::string detectTimezone() {
  // Two reliable Linux signals, in order of preference:
  //   1. /etc/timezone (Debian/Ubuntu convention) — one line, IANA name.
  //   2. readlink /etc/localtime → "/usr/share/zoneinfo/Region/City".
  // TZ env var trumps both when set (matches libc rules).
  if (const char* tz = std::getenv("TZ"); tz && *tz) {
    return tz;
  }
  auto direct = slurp("/etc/timezone");
  if (!direct.empty())
    return direct;
  char buf[PATH_MAX]{};
  ssize_t n = readlink("/etc/localtime", buf, sizeof(buf) - 1);
  if (n > 0) {
    std::string p(buf, static_cast<size_t>(n));
    const std::string marker = "zoneinfo/";
    auto pos = p.find(marker);
    if (pos != std::string::npos)
      return p.substr(pos + marker.size());
  }
  return "UTC";
}

LocaleSnapshot snapshotFor(const std::string& rawLocale) {
  LocaleSnapshot s;
  ParsedLocale parsed = parseLocale(rawLocale);
  s.languageTag = buildTag(parsed);
  s.languageCode = parsed.language;
  s.regionCode = parsed.region;
  s.scriptCode = parsed.script;

  // Pull currency code + separators from glibc for the requested
  // locale. nl_langinfo wants the *current* locale, so we briefly
  // swap with newlocale/uselocale to query without globally
  // mutating the process — guards multi-call use.
  std::string toApply = rawLocale + ".UTF-8";
  locale_t loc = newlocale(LC_ALL_MASK, toApply.c_str(), nullptr);
  if (!loc) {
    // Fall back to the bare name (no .UTF-8 suffix) in case the
    // system locale archive lacks the encoding-suffixed variant.
    loc = newlocale(LC_ALL_MASK, rawLocale.c_str(), nullptr);
  }
  if (loc) {
    locale_t prev = uselocale(loc);
    if (const char* cur = nl_langinfo(__INT_CURR_SYMBOL))
      s.currencyCode = cur;
    // INT_CURR_SYMBOL has a trailing space separator; strip it.
    while (!s.currencyCode.empty() && s.currencyCode.back() == ' ')
      s.currencyCode.pop_back();
    if (const char* sym = nl_langinfo(__CURRENCY_SYMBOL))
      s.currencySymbol = sym;
    if (const char* dec = nl_langinfo(RADIXCHAR))
      s.decimalSeparator = dec;
    if (const char* grp = nl_langinfo(THOUSEP))
      s.digitGroupingSeparator = grp;
    uselocale(prev);
    freelocale(loc);
  }

  s.measuresTemperatureInCelsius = !regionUsesFahrenheit(parsed.region);
  s.temperatureUnit = s.measuresTemperatureInCelsius ? "celsius" : "fahrenheit";
  s.usesMetricSystem = !regionUsesImperial(parsed.region);
  if (regionUsesImperial(parsed.region))
    s.measurementSystem = "us";
  else if (regionMixedSystem(parsed.region))
    s.measurementSystem = "uk";
  else
    s.measurementSystem = "metric";
  s.isRTL = languageIsRTL(parsed.language);
  s.timezone = detectTimezone();
  return s;
}

std::string primaryLocaleEnv() {
  // Order matches glibc's: LC_ALL > LC_MESSAGES > LANG. parseLocale
  // handles the "C" / "C.UTF-8" / "POSIX" sentinels itself (case-
  // insensitive), so we just return the first non-empty value and
  // let it decide whether to fall back to en/US.
  for (const char* key : {"LC_ALL", "LC_MESSAGES", "LANG"}) {
    if (const char* v = std::getenv(key); v && *v) {
      return v;
    }
  }
  return "en_US.UTF-8";
}

} // namespace

LocaleSnapshot snapshot() {
  return snapshotFor(primaryLocaleEnv());
}

std::vector<LocaleSnapshot> preferredLocales() {
  std::vector<LocaleSnapshot> out;
  // LANGUAGE is glibc's priority list (e.g. "en_US:en:de"). Each
  // entry is a fallback if the prior one's translations are missing.
  if (const char* lang = std::getenv("LANGUAGE"); lang && *lang) {
    std::string s = lang;
    size_t start = 0;
    while (start < s.size()) {
      auto end = s.find(':', start);
      auto piece = s.substr(start, end == std::string::npos ? std::string::npos : end - start);
      if (!piece.empty())
        out.push_back(snapshotFor(piece));
      if (end == std::string::npos)
        break;
      start = end + 1;
    }
  }
  if (out.empty())
    out.push_back(snapshot());
  return out;
}

} // namespace rnlinux::locale
