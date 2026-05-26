'use strict';

// Tests here only exercise the JS-side Platform shim, so we deliberately
// skip the `react-native` jest preset — its setup.js tries to require
// internal Libraries/Image/Image, which RN ≥0.76 no longer ships at that
// path and the whole suite fails before our tests can mount.
module.exports = {
  testEnvironment: 'node',
  haste: {
    defaultPlatform: 'linux',
    platforms: ['linux', 'android', 'ios', 'native'],
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.{js,ts,tsx}'],
  moduleFileExtensions: ['linux.js', 'linux.ts', 'linux.tsx', 'js', 'jsx', 'ts', 'tsx', 'json'],
  passWithNoTests: true,
};
