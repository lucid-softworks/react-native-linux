'use strict';

// Shim for `expo-constants`. The real module reads app.json /
// app.config, native platform constants, runtime version, etc. On
// desktop we report what we can and leave fields apps usually only
// reference for analytics empty.

const Constants = {
  appOwnership: null,
  executionEnvironment: 'bare',
  expoVersion: '0.0.0',
  expoConfig: null,
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

module.exports = {
  ...Constants,
  default: Constants,
  __esModule: true,
};
