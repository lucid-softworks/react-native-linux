'use strict';

// `expo-router/entry` is a side-effect import. Real expo-router uses
// a bundler plugin to scan `app/**/*.tsx` at bundle time and emit a
// generated routes module that this entry mounts via
// `registerRootComponent`. We don't have the bundler plugin (would
// need an esbuild/metro hook that runs file discovery), so for
// smoke-coverage purposes the entry registers a tiny placeholder
// component that mounts cleanly.
//
// Apps that need actual routing get a build-time follow-up: a
// codegen step that walks process.env.EXPO_ROUTER_APP_ROOT and emits
// a routes manifest the shim's <Stack> can iterate. Until then, the
// smoke gate sees a real GTK frame paint, which is the C++ Fabric
// regression signal — what we mainly care about.
const React = require('react');
const {View, Text} = require('react-native');
// Require our own expo shim file directly. Going through the bare
// "expo" specifier would have esbuild resolve to node_modules/expo
// at vendor bundle time, which drags in the full SDK's web-side
// boot code (messageSocket.ts touches `window` — Hermes throws).
const {registerRootComponent} = require('./expo');

function ExpoRouterPlaceholder() {
  return React.createElement(
    View,
    {
      style: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#f8fafc',
      },
    },
    React.createElement(
      Text,
      {style: {fontSize: 16, color: '#0f172a', fontWeight: '500'}},
      'expo-router placeholder',
    ),
    React.createElement(
      Text,
      {style: {fontSize: 12, color: '#64748b', marginTop: 8, textAlign: 'center'}},
      'File-based route discovery needs a bundler plugin (TODO).',
    ),
  );
}

registerRootComponent(ExpoRouterPlaceholder);

module.exports = {};
