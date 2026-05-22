import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import type {Command, Config} from '@react-native-community/cli-types';

export const initLinux: Command = {
  name: 'init-linux',
  description: 'Add a linux/ project to an existing React Native app',
  options: [
    {
      name: '--overwrite',
      description: 'Overwrite an existing linux/ directory',
      default: false,
    },
  ],
  func: async (_argv: string[], ctx: Config, opts: {overwrite: boolean}) => {
    const target = path.join(ctx.root, 'linux');
    if (fs.existsSync(target) && !opts.overwrite) {
      console.error(
        chalk.red(
          `linux/ already exists at ${target}. Pass --overwrite to replace it.`,
        ),
      );
      process.exit(1);
    }
    const source = path.resolve(__dirname, '..', '..', 'templates', 'linux');
    if (!fs.existsSync(source)) {
      throw new Error(
        `CLI template missing at ${source}. Did the package install correctly?`,
      );
    }
    await fs.promises.cp(source, target, {recursive: true});
    console.log(chalk.green(`✓ Wrote linux/ project at ${target}`));
    console.log(chalk.gray('  Next: cd linux && cmake -B build -G Ninja && cmake --build build'));
  },
};
