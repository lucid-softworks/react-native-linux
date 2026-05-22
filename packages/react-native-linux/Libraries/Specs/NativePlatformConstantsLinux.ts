import {TurboModuleRegistry} from 'react-native';
import type {TurboModule} from 'react-native';

// TurboModule spec consumed by @react-native/codegen. Produces a C++ header
// (NativePlatformConstantsLinuxSpec.h) that vnext/src/modules/PlatformConstants.cpp
// implements.
export interface Spec extends TurboModule {
  getConstants(): {
    isTesting: boolean;
    reactNativeVersion: {
      major: number;
      minor: number;
      patch: number;
      prerelease: string | null;
    };
    osVersion: number;
    Distribution: string;
    Manufacturer: string;
  };
}

export default TurboModuleRegistry.get<Spec>('PlatformConstants');
