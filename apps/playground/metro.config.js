const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const config = {
  resolver: {
    platforms: ['linux', 'native', 'ios', 'android'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
