'use strict';

// Metro composition helpers for the Linux platform shim layer. Two
// exports — pick whichever matches the consumer's Metro setup style:
//
//   • `linuxExpoShims` — the bare specifier → shim path table. Useful
//     if the consumer wants to assemble their own `resolveRequest`.
//
//   • `withLinuxExpoShims(config)` — a Metro config wrapper that
//     installs an additive `resolveRequest`. Preserves any existing
//     `resolveRequest` on the input config by delegating to it on
//     miss. This is the path used by `expo-desktop`-style consumers
//     where `@expo/metro-config` + `@rnx-kit/metro-config` have
//     already wrapped the config and we slot Linux on top.
//
// Both treat platform !== 'linux' as a hard pass-through, so iOS /
// Android / web bundles see exactly the resolution they would without
// this helper installed.

const SHIM = '@lucid-softworks/react-native-linux-expo';

const linuxExpoShims = {
  expo: `${SHIM}/expo`,
  'expo-application': `${SHIM}/expo-application`,
  'expo-battery': `${SHIM}/expo-battery`,
  'expo-camera': `${SHIM}/expo-camera`,
  'expo-clipboard': `${SHIM}/expo-clipboard`,
  'expo-constants': `${SHIM}/expo-constants`,
  'expo-crypto': `${SHIM}/expo-crypto`,
  'expo-device': `${SHIM}/expo-device`,
  'expo-document-picker': `${SHIM}/expo-document-picker`,
  'expo-file-system': `${SHIM}/expo-file-system`,
  'expo-file-system/legacy': `${SHIM}/expo-file-system-legacy`,
  'expo-font': `${SHIM}/expo-font`,
  'expo-haptics': `${SHIM}/expo-haptics`,
  'expo-image': `${SHIM}/expo-image`,
  'expo-image-picker': `${SHIM}/expo-image-picker`,
  'expo-keep-awake': `${SHIM}/expo-keep-awake`,
  'expo-linking': `${SHIM}/expo-linking`,
  'expo-localization': `${SHIM}/expo-localization`,
  'expo-location': `${SHIM}/expo-location`,
  'expo-network': `${SHIM}/expo-network`,
  'expo-notifications': `${SHIM}/expo-notifications`,
  'expo-print': `${SHIM}/expo-print`,
  'expo-router': `${SHIM}/expo-router`,
  'expo-screen-capture': `${SHIM}/expo-screen-capture`,
  'expo-secure-store': `${SHIM}/expo-secure-store`,
  'expo-sharing': `${SHIM}/expo-sharing`,
  'expo-sms': `${SHIM}/expo-sms`,
  'expo-splash-screen': `${SHIM}/expo-splash-screen`,
  'expo-status-bar': `${SHIM}/expo-status-bar`,
  'expo-symbols': `${SHIM}/expo-symbols`,
  'expo-watermark': `${SHIM}/expo-watermark`,
  'expo-web-browser': `${SHIM}/expo-web-browser`,
  'react-native-reanimated': `${SHIM}/react-native-reanimated`,
  'react-native-safe-area-context': `${SHIM}/react-native-safe-area-context`,
  'react-native-screens': `${SHIM}/react-native-screens`,
  'react-native-mmkv': `${SHIM}/react-native-mmkv`,
  '@react-native-community/netinfo': `${SHIM}/react-native-community-netinfo`,
  crypto: `${SHIM}/node-crypto`,
  'node:crypto': `${SHIM}/node-crypto`,
  '@expo/metro-runtime': `${SHIM}/expo-metro-runtime`,
  'expo-router/entry': `${SHIM}/expo-router-entry`,
};

// Compose a `resolveRequest` that rewrites Linux-platform shims and
// delegates everything else to `next` (or to `context.resolveRequest`
// if no upstream is supplied).
function createLinuxResolver(next) {
  return function resolveRequest(context, moduleName, platform) {
    if (platform === 'linux') {
      const shim = linuxExpoShims[moduleName];
      if (shim) {
        return context.resolveRequest(context, shim, platform);
      }
    }
    if (typeof next === 'function') {
      return next(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

// Wrap an existing Metro config (e.g. the output of
// `@expo/metro-config`'s `getDefaultConfig` or `@rnx-kit/metro-config`'s
// `withMetroConfig`) so Linux bundles see the shim layer. Preserves
// any upstream `resolveRequest` by chaining through it on miss, and
// ensures 'linux' is in the `platforms` list.
function withLinuxExpoShims(config) {
  const base = config || {};
  const resolver = base.resolver || {};
  const upstreamResolve =
    typeof resolver.resolveRequest === 'function' ? resolver.resolveRequest : undefined;
  const platforms = Array.isArray(resolver.platforms) ? resolver.platforms.slice() : [];
  if (!platforms.includes('linux')) {
    platforms.unshift('linux');
  }
  return {
    ...base,
    resolver: {
      ...resolver,
      platforms,
      resolveRequest: createLinuxResolver(upstreamResolve),
    },
  };
}

module.exports = {
  linuxExpoShims,
  createLinuxResolver,
  withLinuxExpoShims,
};
