'use strict';

// Shim for `expo-constants`. The real module reads app.json /
// app.config, native platform constants, runtime version, etc. On
// desktop we report what we can and leave fields apps usually only
// reference for analytics empty.

const Constants = {
  appOwnership: null,
  executionEnvironment: 'bare',
  expoVersion: '0.0.0',
  expoConfig: {
    name: 'react-native-linux',
    slug: 'react-native-linux',
    version: '0.0.0',
    orientation: 'default',
    icon: null,
    splash: {image: null, resizeMode: 'contain', backgroundColor: '#ffffff'},
    updates: {fallbackToCacheTimeout: 0},
    assetBundlePatterns: [],
    ios: {supportsTablet: true},
    android: {adaptiveIcon: {foregroundImage: null, backgroundColor: '#ffffff'}},
    web: {},
    extra: {},
    plugins: [],
  },
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

// Register through expo-modules-core's `globalThis.expo.modules`
// registry so third-party packages doing
// `requireNativeModule('ExpoConstants')` resolve to this Constants
// snapshot.
try {
  const {registerExpoModule} = require('./expo-modules-core');
  registerExpoModule('ExpoConstants', Constants);
} catch (_) {
  /* expo-modules-core not loaded in this context (in-tree unit test) */
}

module.exports = {
  ...Constants,
  default: Constants,
  __esModule: true,
};
