import path from 'path';
import execa from 'execa';
import type {Command, Config} from '@react-native-community/cli-types';

interface BundleLinuxOpts {
  entryFile: string;
  bundleOutput: string;
  assetsDest: string;
  dev: boolean;
  minify: boolean;
  sourcemapOutput?: string;
}

export const bundleLinux: Command = {
  name: 'bundle-linux',
  description: 'Build a Linux JS bundle by invoking Metro with --platform linux',
  options: [
    {name: '--entry-file <path>', description: 'Entry file', default: 'index.js'},
    {
      name: '--bundle-output <path>',
      description: 'Output path for the bundle',
      default: 'linux/build/assets/index.linux.bundle',
    },
    {
      name: '--assets-dest <path>',
      description: 'Where to copy bundled assets',
      default: 'linux/build/assets',
    },
    {name: '--dev', description: 'Dev bundle', default: true},
    {name: '--no-minify', description: 'Disable minification'},
    {name: '--sourcemap-output <path>', description: 'Sourcemap output'},
  ],
  func: async (_argv: string[], ctx: Config, opts: BundleLinuxOpts) => {
    const bundleOutput = path.resolve(ctx.root, opts.bundleOutput);
    const assetsDest = path.resolve(ctx.root, opts.assetsDest);

    const args = [
      'bundle',
      '--platform',
      'linux',
      '--entry-file',
      opts.entryFile,
      '--bundle-output',
      bundleOutput,
      '--assets-dest',
      assetsDest,
      '--dev',
      String(opts.dev),
      '--minify',
      String(opts.minify),
    ];
    if (opts.sourcemapOutput) {
      args.push('--sourcemap-output', path.resolve(ctx.root, opts.sourcemapOutput));
    }

    await execa('react-native', args, {stdio: 'inherit', cwd: ctx.root});
  },
};
