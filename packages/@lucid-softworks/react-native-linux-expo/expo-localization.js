'use strict';

// Shim for `expo-localization`. Backed by libc + sysfs reads in
// vnext/src/locale/Locale.cpp — LC_ALL/LANG parsing,
// nl_langinfo for currency/separators, /etc/timezone for IANA tz,
// CLDR-equivalent heuristics for isRTL / measurementSystem /
// temperatureUnit.
//
// The native snapshot is the source of truth; this shim arranges it
// into the shape upstream consumers expect (top-level fields for
// the legacy API, getLocales()/getCalendars() for the v15+ API,
// useLocales/useCalendars hooks).

const React = require('react');

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.localeSnapshot === 'function';

function _snap() {
  if (!_hasNative) {
    return {
      languageTag: 'en-US',
      languageCode: 'en',
      regionCode: 'US',
      scriptCode: '',
      currencyCode: 'USD',
      currencySymbol: '$',
      decimalSeparator: '.',
      digitGroupingSeparator: ',',
      measuresTemperatureInCelsius: false,
      usesMetricSystem: false,
      measurementSystem: 'us',
      temperatureUnit: 'fahrenheit',
      textDirection: 'ltr',
      isRTL: false,
      timezone: 'UTC',
      firstWeekday: 1,
    };
  }
  return rnLinux.localeSnapshot();
}

function _preferred() {
  if (!_hasNative) return [_snap()];
  return rnLinux.localePreferred();
}

// ─── Top-level fields (legacy API) ────────────────────────────────
// Snapshot once at import time, same as upstream — the fields are
// constants for the lifetime of an app launch. Hot-reload during
// dev re-evaluates this module so they refresh.
const _primary = _snap();

const locale = _primary.languageTag;
const locales = _preferred().map(s => s.languageTag);
const region = _primary.regionCode || null;
const currency = _primary.currencyCode || null;
const decimalSeparator = _primary.decimalSeparator || '.';
const digitGroupingSeparator = _primary.digitGroupingSeparator || ',';
const measurementSystem = _primary.measurementSystem;
const temperatureUnit = _primary.temperatureUnit;
const timezone = _primary.timezone;
const isRTL = _primary.isRTL;
const isMetric = _primary.usesMetricSystem;

// ─── v15+ API: getLocales() / getCalendars() ──────────────────────

function getLocales() {
  return _preferred().map(s => ({
    languageTag: s.languageTag,
    languageCode: s.languageCode,
    languageScriptCode: s.scriptCode || null,
    languageRegionCode: s.regionCode || null,
    regionCode: s.regionCode || null,
    currencyCode: s.currencyCode || null,
    currencySymbol: s.currencySymbol || null,
    decimalSeparator: s.decimalSeparator || null,
    digitGroupingSeparator: s.digitGroupingSeparator || null,
    textDirection: s.textDirection,
    measurementSystem: s.measurementSystem,
    temperatureUnit: s.temperatureUnit,
  }));
}

function getCalendars() {
  // Linux desktops don't expose a per-locale calendar preference
  // distinct from the Gregorian default; CLDR has alternatives
  // (japanese, hijri, persian) but no env var or D-Bus property
  // surfaces user choice. Report Gregorian + the real timezone +
  // the CLDR per-region firstWeekday from our native snapshot
  // (1=Sunday across the Americas / East Asia, 7=Saturday across
  // the Arabian peninsula, 2=Monday everywhere else).
  return [
    {
      calendar: 'gregory',
      timeZone: _primary.timezone,
      uses24hourClock: true,
      firstWeekday: typeof _primary.firstWeekday === 'number' ? _primary.firstWeekday : 2,
    },
  ];
}

// ─── Hooks (v15+) ─────────────────────────────────────────────────
// Subscribe to the native locale-change trampoline so a
// `localectl set-locale` in another shell re-renders the app.
// Locale flips are very rare but the cost of staying subscribed
// is zero (GFileMonitor only wakes when the file actually
// changes), so we always wire it.

const _localeSubs = new Set();
let _localeNativeWired = false;

function _ensureLocaleWired() {
  if (_localeNativeWired) return;
  if (typeof rnLinux === 'undefined' || typeof rnLinux.localeSetListener !== 'function') return;
  rnLinux.localeSetListener(() => {
    for (const fn of _localeSubs) {
      try {
        fn();
      } catch (_) {}
    }
  });
  _localeNativeWired = true;
}

function _teardownLocaleIfIdle() {
  if (!_localeNativeWired || _localeSubs.size > 0) return;
  if (typeof rnLinux === 'undefined' || typeof rnLinux.localeSetListener !== 'function') return;
  rnLinux.localeSetListener(null);
  _localeNativeWired = false;
}

function _useLocaleTick() {
  // Bump a counter when the native subscription fires so memoized
  // values recompute. Cheaper than passing the snapshot through —
  // useLocales / useCalendars re-read it themselves.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const onChange = () => setTick(t => t + 1);
    _localeSubs.add(onChange);
    _ensureLocaleWired();
    return () => {
      _localeSubs.delete(onChange);
      _teardownLocaleIfIdle();
    };
  }, []);
  return tick;
}

function useLocales() {
  const tick = _useLocaleTick();
  return React.useMemo(() => getLocales(), [tick]);
}

function useCalendars() {
  const tick = _useLocaleTick();
  return React.useMemo(() => getCalendars(), [tick]);
}

// ─── Async getters — match upstream's "async forever" history ────

async function getLocalizationAsync() {
  return {
    locale,
    locales,
    region,
    currency,
    decimalSeparator,
    digitGroupingSeparator,
    measurementSystem,
    temperatureUnit,
    timezone,
    isRTL,
    isMetric,
  };
}

const Calendar = {
  buddhist: 'buddhist',
  chinese: 'chinese',
  coptic: 'coptic',
  dangi: 'dangi',
  ethioaa: 'ethioaa',
  ethiopic: 'ethiopic',
  gregory: 'gregory',
  hebrew: 'hebrew',
  indian: 'indian',
  islamic: 'islamic',
  iso8601: 'iso8601',
  japanese: 'japanese',
  persian: 'persian',
  roc: 'roc',
};

const TextDirection = {LTR: 'ltr', RTL: 'rtl'};
const MeasurementSystem = {METRIC: 'metric', US: 'us', UK: 'uk'};
const TemperatureUnit = {CELSIUS: 'celsius', FAHRENHEIT: 'fahrenheit'};
const Weekday = {
  SUNDAY: 1,
  MONDAY: 2,
  TUESDAY: 3,
  WEDNESDAY: 4,
  THURSDAY: 5,
  FRIDAY: 6,
  SATURDAY: 7,
};

const api = {
  // Top-level legacy fields
  locale,
  locales,
  region,
  currency,
  decimalSeparator,
  digitGroupingSeparator,
  measurementSystem,
  temperatureUnit,
  timezone,
  isRTL,
  isMetric,
  // v15+ functions + hooks
  getLocales,
  getCalendars,
  useLocales,
  useCalendars,
  // Legacy async
  getLocalizationAsync,
  // Enums
  Calendar,
  TextDirection,
  MeasurementSystem,
  TemperatureUnit,
  Weekday,
};

module.exports = api;
module.exports.default = api;
