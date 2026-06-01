const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const {withLinuxExpoShims} = require('@lucid-softworks/react-native-linux-expo/metro');

// Mirror of template/metro.config.js with monorepo-specific
// watchFolders + nodeModulesPaths so Metro can resolve workspace
// packages reached via pnpm symlinks at ../../packages/*. The bespoke
// esbuild bundler in `bundle.mjs` stays the default for fast dev
// iteration — this Metro config is the parity path that end-user
// (non-monorepo) apps will use via template/metro.config.js.
//
// Shim resolution is shared with the template via
// `@lucid-softworks/react-native-linux-expo/metro` so a new shim only
// has to land in one place.
const repoRoot = path.resolve(__dirname, '../..');

module.exports = withLinuxExpoShims(
  mergeConfig(getDefaultConfig(__dirname), {
    watchFolders: [repoRoot],
    resolver: {
      platforms: ['linux', 'ios', 'android', 'native'],
      nodeModulesPaths: [path.join(__dirname, 'node_modules'), path.join(repoRoot, 'node_modules')],
    },
  }),
);
