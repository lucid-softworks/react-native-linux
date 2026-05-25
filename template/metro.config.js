const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Bare specifiers that should resolve to our Expo-ecosystem shims when
// bundling for the `linux` platform. The shim package lives at
// `@lucid-softworks/react-native-linux-expo`; each entry maps a module
// the app might import to a file within that package. iOS and Android
// resolution stays untouched.
//
// Add entries as shims are migrated from apps/playground/runtime/ into
// the umbrella package. A specifier that isn't in this table falls
// through to Metro's default resolver — which will try the user's real
// (iOS/Android-targeted) implementation and most likely fail at runtime
// under Hermes-on-Linux.
const linuxExpoShims = {
  expo: '@lucid-softworks/react-native-linux-expo/expo',
  'expo-constants': '@lucid-softworks/react-native-linux-expo/expo-constants',
  'expo-font': '@lucid-softworks/react-native-linux-expo/expo-font',
  'expo-linking': '@lucid-softworks/react-native-linux-expo/expo-linking',
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
  resolver: {
    platforms: ['linux', 'ios', 'android', 'native'],
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
