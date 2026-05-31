'use strict';

// `@expo/metro-runtime` is a tiny bootstrap that real Expo apps
// import from their root entry — it installs:
//   * a custom HMR client wired to Metro
//   * a `__r` global that wraps Metro's module registry
//   * source-map support for stack traces from Metro chunks
//
// None of that applies to our esbuild bundler. The package exists
// as a side-effect import (apps do `import '@expo/metro-runtime'`),
// so a noop module that just re-exports an empty object satisfies
// the import without dragging in Metro internals.
//
// expo-router/entry imports this transitively; the smoke matrix
// would otherwise bubble the missing-module error all the way up.
module.exports = {};
