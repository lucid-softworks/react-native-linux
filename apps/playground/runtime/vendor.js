'use strict';

// Vendor bundle entry: loads React + react-reconciler + react-refresh +
// our runtime (shims, hostConfig, fabric, components) ONCE on cold
// start. The C++ host evaluates this before the app bundle and never
// re-evaluates it — that's what gives Fast Refresh a stable React
// instance to attach to.
//
// Everything is exposed on globalThis.__rnv so the app bundle's
// require-shim can hand it back as if it were `require('react')` /
// `require('./runtime')` / etc.

require('./shims');

// IMPORTANT: install the devtools hook BEFORE react-reconciler loads.
// The reconciler captures `__REACT_DEVTOOLS_GLOBAL_HOOK__` via bare-
// identifier lookup at module-load time (rewritten by esbuild's
// define to `globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__`). If the hook
// isn't present at that point, the reconciler permanently skips Fast
// Refresh registration.
const RefreshRuntime = require('react-refresh/runtime');
RefreshRuntime.injectIntoGlobalHook(globalThis);

const React = require('react');
const Reconciler = require('react-reconciler');
globalThis.$RefreshReg$ = (type, id) => {
  if (RefreshRuntime.isLikelyComponentType(type)) {
    RefreshRuntime.register(type, id);
  }
};
globalThis.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;
globalThis.__refreshRuntime = RefreshRuntime;

// runtime/* modules need require('react') etc. to resolve to the
// versions we've already loaded above. Stash them so the app
// bundle's require shim can fetch them.
const fabricMod = require('./fabric');
const {View, ScrollView, Image, Text, TextInput, Pressable, Button} = require('./components');
const StyleSheet = require('./stylesheet');
const componentsMod = {View, ScrollView, Image, Text, TextInput, Pressable, Button, StyleSheet};
// react-native module shim — apps that import {View, Text} from
// 'react-native' work without changes. Must be required AFTER the
// runtime is wired so its `require('./')` resolves to a populated
// componentsMod (via the same vendor table below).
const reactNativeMod = require('./react-native');
const asyncStorageMod = require('./async-storage');
const deviceInfoMod = require('./device-info');
const expoMod = require('@lucid-softworks/react-native-linux-expo/expo');
const expoStatusBarMod = require('@lucid-softworks/react-native-linux-expo/expo-status-bar');
const expoFontMod = require('@lucid-softworks/react-native-linux-expo/expo-font');
const expoSplashScreenMod = require('@lucid-softworks/react-native-linux-expo/expo-splash-screen');
const expoWebBrowserMod = require('@lucid-softworks/react-native-linux-expo/expo-web-browser');
const expoSymbolsMod = require('@lucid-softworks/react-native-linux-expo/expo-symbols');
const expoConstantsMod = require('@lucid-softworks/react-native-linux-expo/expo-constants');
const expoCameraMod = require('@lucid-softworks/react-native-linux-expo/expo-camera');
const expoLinkingMod = require('@lucid-softworks/react-native-linux-expo/expo-linking');
const expoLocationMod = require('@lucid-softworks/react-native-linux-expo/expo-location');
const expoNotificationsMod = require('@lucid-softworks/react-native-linux-expo/expo-notifications');
// Stub shims for modules in the TODO.md "Expo module backlog". Each
// import returns a Proxy that throws "not yet implemented" on any
// property access — so apps that conditionally import them won't
// crash at load time, but the smoke test surfaces them as ✗.
const expoBatteryMod = require('@lucid-softworks/react-native-linux-expo/expo-battery');
const expoClipboardMod = require('@lucid-softworks/react-native-linux-expo/expo-clipboard');
const expoDocumentPickerMod = require('@lucid-softworks/react-native-linux-expo/expo-document-picker');
const expoFileSystemMod = require('@lucid-softworks/react-native-linux-expo/expo-file-system');
const expoHapticsMod = require('@lucid-softworks/react-native-linux-expo/expo-haptics');
const expoImageMod = require('@lucid-softworks/react-native-linux-expo/expo-image');
const expoImagePickerMod = require('@lucid-softworks/react-native-linux-expo/expo-image-picker');
const expoKeepAwakeMod = require('@lucid-softworks/react-native-linux-expo/expo-keep-awake');
const expoLocalizationMod = require('@lucid-softworks/react-native-linux-expo/expo-localization');
const expoNetworkMod = require('@lucid-softworks/react-native-linux-expo/expo-network');
const expoPrintMod = require('@lucid-softworks/react-native-linux-expo/expo-print');
const expoScreenCaptureMod = require('@lucid-softworks/react-native-linux-expo/expo-screen-capture');
const expoSecureStoreMod = require('@lucid-softworks/react-native-linux-expo/expo-secure-store');
const expoSharingMod = require('@lucid-softworks/react-native-linux-expo/expo-sharing');
const safeAreaCtxMod = require('@lucid-softworks/react-native-linux-expo/react-native-safe-area-context');
const screensMod = require('@lucid-softworks/react-native-linux-expo/react-native-screens');
const reanimatedMod = require('@lucid-softworks/react-native-linux-expo/react-native-reanimated');
const expoRouterMod = require('@lucid-softworks/react-native-linux-expo/expo-router');
const errorBoundaryMod = require('@lucid-softworks/react-native-linux-expo/error-boundary');
const hostConfigMod = require('./fabricHostConfig');

const reactJsxRuntime = require('react/jsx-runtime');
const reactJsxDevRuntime = require('react/jsx-dev-runtime');

globalThis.__rnv = {
  react: React,
  reactJsxRuntime,
  reactJsxDevRuntime,
  reactReconciler: Reconciler,
  reactRefreshRuntime: RefreshRuntime,
  reactNative: reactNativeMod,
  asyncStorage: asyncStorageMod,
  deviceInfo: deviceInfoMod,
  expo: expoMod,
  expoStatusBar: expoStatusBarMod,
  expoFont: expoFontMod,
  expoSplashScreen: expoSplashScreenMod,
  expoWebBrowser: expoWebBrowserMod,
  expoSymbols: expoSymbolsMod,
  expoConstants: expoConstantsMod,
  expoCamera: expoCameraMod,
  expoLinking: expoLinkingMod,
  expoLocation: expoLocationMod,
  expoNotifications: expoNotificationsMod,
  expoBattery: expoBatteryMod,
  expoClipboard: expoClipboardMod,
  expoDocumentPicker: expoDocumentPickerMod,
  expoFileSystem: expoFileSystemMod,
  expoHaptics: expoHapticsMod,
  expoImage: expoImageMod,
  expoImagePicker: expoImagePickerMod,
  expoKeepAwake: expoKeepAwakeMod,
  expoLocalization: expoLocalizationMod,
  expoNetwork: expoNetworkMod,
  expoPrint: expoPrintMod,
  expoScreenCapture: expoScreenCaptureMod,
  expoSecureStore: expoSecureStoreMod,
  expoSharing: expoSharingMod,
  safeAreaContext: safeAreaCtxMod,
  screens: screensMod,
  reanimated: reanimatedMod,
  expoRouter: expoRouterMod,
  errorBoundary: errorBoundaryMod,
  runtime: {
    ...fabricMod,
    ...componentsMod,
  },
  hostConfig: hostConfigMod,
};

rnLinux.log('info', '[vendor] react + reconciler + refresh-runtime loaded');
