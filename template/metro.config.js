const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Out-of-tree platform support: tell Metro that 'linux' is a valid platform,
// and let it pick up `*.linux.js` extensions from react-native-linux first.
const config = {
  resolver: {
    platforms: ['linux', 'ios', 'android', 'native'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
