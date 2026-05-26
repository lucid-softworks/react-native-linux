'use strict';

// Out-of-tree Platform module for Linux. Metro picks this up over
// react-native/Libraries/Utilities/Platform.js because the linux CLI plugin
// adds 'linux' to Metro's resolver.platforms list.

const NativePlatformConstantsLinux = require('../Specs/NativePlatformConstantsLinux').default;

let constants = null;

const Platform = {
  __constants: null,
  OS: 'linux',
  get Version() {
    return this.constants.osVersion ?? 0;
  },
  get constants() {
    if (constants == null) {
      constants = NativePlatformConstantsLinux
        ? NativePlatformConstantsLinux.getConstants()
        : {
            isTesting: false,
            reactNativeVersion: {major: 0, minor: 76, patch: 0, prerelease: null},
            osVersion: 0,
            Distribution: 'unknown',
            Manufacturer: 'unknown',
          };
    }
    return constants;
  },
  get isTV() {
    return false;
  },
  get isTesting() {
    return this.constants.isTesting === true;
  },
  select(spec) {
    return 'linux' in spec ? spec.linux : 'native' in spec ? spec.native : spec.default;
  },
};

module.exports = Platform;
