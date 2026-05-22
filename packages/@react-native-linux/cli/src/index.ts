import {runLinux} from './commands/runLinux';
import {bundleLinux} from './commands/bundleLinux';
import {initLinux} from './commands/initLinux';
import {logLinux} from './commands/logLinux';
import {projectConfig, dependencyConfig} from './platformConfig';

export const commands = [runLinux, bundleLinux, initLinux, logLinux];

export const platforms = {
  linux: {
    npmPackageName: 'react-native-linux',
    projectConfig,
    dependencyConfig,
  },
};

export {projectConfig, dependencyConfig};
