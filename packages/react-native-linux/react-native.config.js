// react-native CLI plugin config. The linux platform itself is registered by
// @react-native-linux/cli; this file just declares that this package does not
// auto-link any extra native modules.
module.exports = {
  dependency: {
    platforms: {
      linux: null,
    },
  },
};
