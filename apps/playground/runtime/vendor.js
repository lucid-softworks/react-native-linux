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
const hostConfigMod = require('./fabricHostConfig');

const reactJsxRuntime = require('react/jsx-runtime');
const reactJsxDevRuntime = require('react/jsx-dev-runtime');

globalThis.__rnv = {
  react: React,
  reactJsxRuntime,
  reactJsxDevRuntime,
  reactReconciler: Reconciler,
  reactRefreshRuntime: RefreshRuntime,
  runtime: {
    ...fabricMod,
    ...componentsMod,
  },
  hostConfig: hostConfigMod,
};

rnLinux.log('info', '[vendor] react + reconciler + refresh-runtime loaded');
