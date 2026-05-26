const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Mirror of template/metro.config.js with monorepo-specific
// watchFolders + nodeModulesPaths so Metro can resolve workspace
// packages reached via pnpm symlinks at ../../packages/*. The bespoke
// esbuild bundler in `bundle.mjs` stays the default for fast dev
// iteration — this Metro config is the parity path that end-user
// (non-monorepo) apps will use via template/metro.config.js.
const repoRoot = path.resolve(__dirname, '../..');

const linuxExpoShims = {
  expo: '@lucid-softworks/react-native-linux-expo/expo',
  'expo-camera': '@lucid-softworks/react-native-linux-expo/expo-camera',
  'expo-constants': '@lucid-softworks/react-native-linux-expo/expo-constants',
  'expo-font': '@lucid-softworks/react-native-linux-expo/expo-font',
  'expo-linking': '@lucid-softworks/react-native-linux-expo/expo-linking',
  'expo-location': '@lucid-softworks/react-native-linux-expo/expo-location',
  'expo-router': '@lucid-softworks/react-native-linux-expo/expo-router',
  'expo-splash-screen': '@lucid-softworks/react-native-linux-expo/expo-splash-screen',
  'expo-status-bar': '@lucid-softworks/react-native-linux-expo/expo-status-bar',
  'expo-symbols': '@lucid-softworks/react-native-linux-expo/expo-symbols',
  'expo-web-browser': '@lucid-softworks/react-native-linux-expo/expo-web-browser',
  'react-native-reanimated': '@lucid-softworks/react-native-linux-expo/react-native-reanimated',
  'react-native-safe-area-context':
    '@lucid-softworks/react-native-linux-expo/react-native-safe-area-context',
  'react-native-screens': '@lucid-softworks/react-native-linux-expo/react-native-screens',
};

const config = {
  watchFolders: [repoRoot],
  resolver: {
    platforms: ['linux', 'ios', 'android', 'native'],
    nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(repoRoot, 'node_modules')],
    resolveRequest: (context, moduleName, platform) => {
      if (platform === 'linux') {
        const shim = linuxExpoShims[moduleName];
        if (shim) {
          return context.resolveRequest(context, shim, platform);
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
