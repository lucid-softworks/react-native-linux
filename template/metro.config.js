const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {withLinuxExpoShims} = require('@lucid-softworks/react-native-linux-expo/metro');

// Linux platform shim resolution lives in
// `@lucid-softworks/react-native-linux-expo/metro` so out-of-tree
// consumers (expo-desktop, custom Expo wrappers) can compose the same
// resolver on top of their own base config. See the helper for the
// full bare-specifier → shim table.
//
// `withLinuxExpoShims` is additive: it preserves any upstream
// `resolveRequest`, falls through to the default resolver for
// non-Linux platforms, and inserts `linux` into `resolver.platforms`
// if it isn't already there.

module.exports = withLinuxExpoShims(
  mergeConfig(getDefaultConfig(__dirname), {
    resolver: {
      platforms: ['linux', 'ios', 'android', 'native'],
    },
  }),
);
