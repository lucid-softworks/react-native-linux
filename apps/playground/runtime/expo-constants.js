'use strict';

// Shim for `expo-constants`. The real module reads app.json /
// app.config, native platform constants, runtime version, etc. On
// desktop we report what we can and leave fields apps usually only
// reference for analytics empty.

const Constants = {
  // Always available on real Expo
  appOwnership: null, // not "expo" since we're not in Expo Go
  executionEnvironment: 'bare', // not 'storeClient' / 'standalone'
  expoVersion: '0.0.0',
  expoConfig: null, // populated from app.json on real Expo
  manifest: null,
  manifest2: null,
  installationId: 'rnl-installation',
  sessionId: 'rnl-session-' + Date.now(),
  deviceName: 'react-native-linux',
  deviceYearClass: null,
  isDevice: true,
  systemFonts: [],
  platform: {
    web: undefined,
    ios: undefined,
    android: undefined,
    // Apps often switch on Constants.platform.ios.platform / .android,
    // hence the empty objects rather than nulls — they read fields
    // without first guarding.
    linux: {model: 'unknown', userAgent: 'react-native-linux'},
  },
  statusBarHeight: 0,
  systemVersion: '0',
  nativeAppVersion: '0.0.0',
  nativeBuildVersion: '0',
};

// Plain CJS export — let esbuild's __toESM helper wrap it. Without
// __esModule, __toESM sets target.default = mod, and copyProps adds
// each Constants field as a getter on target. So both
// `import Constants from 'expo-constants'` (gets the default which
// is the whole Constants object) and `import {deviceName}` work.
// Mirror expo-status-bar's shape: spread named fields, plus an
// explicit `default` + `__esModule`. With patchHermesForOfBug in
// bundle.mjs fixing the for-of-let closure bug, both default and
// named imports come out correctly.
module.exports = {
  ...Constants,
  default: Constants,
  __esModule: true,
};
