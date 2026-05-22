'use strict';

// Use react-native's preset so platform extension resolution + the standard
// transformer chain matches consumer apps.
module.exports = {
  preset: 'react-native',
  testEnvironment: 'node',
  haste: {
    defaultPlatform: 'linux',
    platforms: ['linux', 'android', 'ios', 'native'],
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.{js,ts,tsx}'],
  moduleFileExtensions: [
    'linux.js',
    'linux.ts',
    'linux.tsx',
    'js',
    'jsx',
    'ts',
    'tsx',
    'json',
  ],
  passWithNoTests: true,
};
