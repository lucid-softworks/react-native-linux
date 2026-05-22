'use strict';

// Spot-check the Linux Platform shim. We mock the TurboModule so the test
// runs without any native side; the goal is to lock down the public API
// (Platform.OS, Platform.select, isTV) so accidental drifts get caught.

jest.mock('../Libraries/Specs/NativePlatformConstantsLinux', () => ({
  __esModule: true,
  default: {
    getConstants: () => ({
      isTesting: true,
      reactNativeVersion: {major: 0, minor: 76, patch: 0, prerelease: null},
      osVersion: 24,
      Distribution: 'Ubuntu 24.04 LTS',
      Manufacturer: 'ubuntu',
    }),
  },
}));

const Platform = require('../Libraries/Utilities/Platform.linux');

describe('Platform.linux', () => {
  test('OS is "linux"', () => {
    expect(Platform.OS).toBe('linux');
  });

  test('isTV is false', () => {
    expect(Platform.isTV).toBe(false);
  });

  test('isTesting reflects native constants', () => {
    expect(Platform.isTesting).toBe(true);
  });

  test('Version comes from osVersion', () => {
    expect(Platform.Version).toBe(24);
  });

  test('select prefers linux over native + default', () => {
    expect(Platform.select({linux: 'L', native: 'N', default: 'D'})).toBe('L');
    expect(Platform.select({native: 'N', default: 'D'})).toBe('N');
    expect(Platform.select({default: 'D'})).toBe('D');
  });
});
