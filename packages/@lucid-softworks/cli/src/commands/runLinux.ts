import path from 'path';
import execa from 'execa';
import chalk from 'chalk';
import type {Command, Config} from '@react-native-community/cli-types';

interface RunLinuxOpts {
  release: boolean;
  noPackager: boolean;
  buildDir: string;
  packagerPort: number;
}

export const runLinux: Command = {
  name: 'run-linux',
  description: 'Build and run a React Native Linux app via CMake + GTK4',
  options: [
    {
      name: '--release',
      description: 'Configure CMake in Release mode',
      default: false,
    },
    {
      name: '--no-packager',
      description: 'Do not launch Metro before running',
      default: false,
    },
    {
      name: '--build-dir <string>',
      description: 'CMake build directory (relative to linux/)',
      default: 'build',
    },
    {
      name: '--packager-port <number>',
      description: 'Metro packager port',
      default: 8081,
      parse: (v: string) => Number(v),
    },
  ],
  func: async (_argv: string[], ctx: Config, opts: RunLinuxOpts) => {
    const platform = ctx.platforms.linux;
    if (!platform) {
      throw new Error(
        'linux platform is not configured. Did you forget to add @lucid-softworks/react-native-linux-cli to your project?',
      );
    }
    const projCfg = (ctx.project as any).linux as
      | {sourceDir: string; executableName: string}
      | undefined;
    if (!projCfg) {
      throw new Error(
        'No linux/ project found. Run `react-native init-linux` first.',
      );
    }

    const buildDir = path.resolve(projCfg.sourceDir, opts.buildDir);
    const buildType = opts.release ? 'Release' : 'Debug';

    console.log(
      chalk.cyan(`▸ Configuring CMake (${buildType}) in ${buildDir}`),
    );
    await execa(
      'cmake',
      [
        '-S',
        projCfg.sourceDir,
        '-B',
        buildDir,
        '-G',
        'Ninja',
        `-DCMAKE_BUILD_TYPE=${buildType}`,
      ],
      {stdio: 'inherit'},
    );

    console.log(chalk.cyan('▸ Building'));
    await execa('cmake', ['--build', buildDir], {stdio: 'inherit'});

    if (!opts.noPackager) {
      console.log(chalk.cyan(`▸ Metro should be running on :${opts.packagerPort}`));
      console.log(
        chalk.gray('  (start it separately with `pnpm start --port ' + opts.packagerPort + '` if not already running)'),
      );
    }

    const executable = path.join(buildDir, projCfg.executableName);
    console.log(chalk.cyan(`▸ Launching ${executable}`));
    await execa(executable, [], {
      stdio: 'inherit',
      env: {
        ...process.env,
        RN_METRO_HOST: '127.0.0.1',
        RN_METRO_PORT: String(opts.packagerPort),
      },
    });
  },
};
