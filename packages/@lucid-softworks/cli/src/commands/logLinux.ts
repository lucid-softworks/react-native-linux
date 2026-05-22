import execa from 'execa';
import type {Command} from '@react-native-community/cli-types';

export const logLinux: Command = {
  name: 'log-linux',
  description: 'Tail logs from a running react-native-linux app via journalctl',
  options: [
    {
      name: '--executable <name>',
      description: 'Executable name to filter journal for',
      default: 'rn-linux-app',
    },
  ],
  func: async (_argv: string[], _ctx, opts: {executable: string}) => {
    await execa(
      'journalctl',
      ['--user', '-f', `_COMM=${opts.executable}`],
      {stdio: 'inherit'},
    );
  },
};
