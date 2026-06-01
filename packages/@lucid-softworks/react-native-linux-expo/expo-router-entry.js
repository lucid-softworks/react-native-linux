'use strict';

// `expo-router/entry` is a side-effect import. Real expo-router uses a
// babel plugin to scan `app/**/*.{tsx,ts,...}` at bundle time and emit
// a routes manifest the runtime mounts via registerRootComponent.
//
// We replicate that with an esbuild plugin (`expoRouterRoutesPlugin` in
// apps/playground/bundle.mjs) that walks process.env.EXPO_ROUTER_APP_ROOT
// at BUNDLE TIME, requires every route file, and assigns the resulting
// components to globalThis.__expoRouterRoutes. This entry then mounts
// the root `_layout` — the shim's <Stack>/<Slot> machinery
// (expo-router.js) does the rest.
//
// Two paths from here:
//   * routes['/_layout'] exists  → mount it as the root component.
//     The layout typically returns <Stack /> or <Slot /> which read
//     back from __expoRouterRoutes to pick the active screen.
//   * routes['/_layout'] missing → fall back to a placeholder so the
//     paint still hits and the smoke gate (looking for "JSX commit
//     done") still passes.

const React = require('react');
const {View, Text} = require('react-native');
// Require our own expo shim directly. Going through the bare "expo"
// specifier would have esbuild resolve to node_modules/expo at vendor
// bundle time, which drags in the full SDK's web boot code
// (messageSocket.ts touches `window` — Hermes throws).
const {registerRootComponent} = require('./expo');

// The routes manifest is expected to ALREADY be on globalThis at this
// point — populated by the app-bundle-side wrapper that imports
// `lucid-expo-router-routes` (the virtual module emitted by
// expoRouterRoutesPlugin in bundle.mjs). Vendor bundles, where this
// file lives, can't host the plugin's emitted code: vendor is built
// once and shared across every example. So we just check + mount.

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
      'EXPO_ROUTER_APP_ROOT not set, or no /_layout in the route table.',
    ),
  );
}

const routes = (globalThis.__expoRouterRoutes = globalThis.__expoRouterRoutes || {});
// If the example didn't ship a root _layout (some examples like
// with-openai only have an index.tsx), synthesize one that just
// renders <Slot/>. Real expo-router does the same — the framework's
// default root layout is a bare slot.
const hasAnyRoutes = Object.keys(routes).some(k => k !== '/_layout');
let RootLayout = routes['/_layout'];
if (!RootLayout && hasAnyRoutes) {
  const {Slot} = require('./expo-router');
  RootLayout = function DefaultRootLayout() {
    return React.createElement(Slot, null);
  };
}

if (RootLayout) {
  // The router provider has to live ABOVE the user's _layout so that
  // useRouter()/usePathname() inside the layout (and any <Slot>/<Stack>
  // it renders) resolve to a real router context rather than the
  // read-only RouterStub. We reuse the shim's RootRouter from
  // ./expo-router which sets up makeRouter + activeNav singleton.
  const {RootRouter} = require('./expo-router');
  function ExpoRouterRoot() {
    try {
      return React.createElement(RootRouter, null, React.createElement(RootLayout, null));
    } catch (err) {
      console.warn('[expo-router] root layout threw:', err && err.message);
      return React.createElement(ExpoRouterPlaceholder, null);
    }
  }
  registerRootComponent(ExpoRouterRoot);
} else {
  registerRootComponent(ExpoRouterPlaceholder);
}

module.exports = {};
