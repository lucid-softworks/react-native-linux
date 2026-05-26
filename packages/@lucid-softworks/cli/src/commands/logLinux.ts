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
  // See packLinux.ts: CommandFunction<Object> can't express our opts shape.
  func: (async (_argv: string[], _ctx, rawOpts: unknown) => {
    const opts = rawOpts as {executable: string};
    await execa('journalctl', ['--user', '-f', `_COMM=${opts.executable}`], {stdio: 'inherit'});
  }) as Command['func'],
};
