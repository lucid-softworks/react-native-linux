import {runLinux} from './commands/runLinux';
import {bundleLinux} from './commands/bundleLinux';
import {initLinux} from './commands/initLinux';
import {logLinux} from './commands/logLinux';
import {autolinkLinux} from './commands/autolinkLinux';
import {projectConfig, dependencyConfig} from './platformConfig';

export const commands = [
  runLinux,
  bundleLinux,
  initLinux,
  logLinux,
  autolinkLinux,
];

export const platforms = {
  linux: {
    npmPackageName: '@lucid-softworks/react-native-linux',
    projectConfig,
    dependencyConfig,
  },
};

export {projectConfig, dependencyConfig};
