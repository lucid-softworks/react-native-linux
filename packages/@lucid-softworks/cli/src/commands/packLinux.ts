import fs from 'fs';
import path from 'path';
import execa from 'execa';
import type {Command, Config} from '@react-native-community/cli-types';

interface PackLinuxOpts {
  target: 'appimage' | 'deb';
  appDir: string;
  executable: string;
  output?: string;
  name?: string;
  version?: string;
  desktop?: string;
  icon?: string;
  bundle?: string;
  vendorBundle?: string;
  maintainer?: string;
  description?: string;
  depends?: string;
  noFetch?: boolean;
}

// Find the wrapper shell scripts relative to this package, so the CLI
// works whether it's running from the monorepo or out of node_modules.
function scriptPath(name: string): string {
  // packages/@lucid-softworks/cli/lib/commands/packLinux.js
  //   → repoRoot/scripts/package/<name>.sh
  // packages/@lucid-softworks/cli/src/commands/packLinux.ts (dev)
  //   → same lookup; the script source ships with the linux runtime.
  const here = path.dirname(__filename);
  const candidates = [
    path.resolve(here, '../../../../../scripts/package', name),
    path.resolve(here, '../../../../scripts/package', name),
    path.resolve(here, '../../scripts/package', name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Could not locate scripts/package/${name}. ` +
      `Make sure the @lucid-softworks/react-native-linux runtime is installed alongside the CLI.`,
  );
}

async function packAppImage(ctx: Config, opts: PackLinuxOpts) {
  const args = [
    '--app-dir',
    path.resolve(ctx.root, opts.appDir),
    '--executable',
    opts.executable,
    '--desktop',
    path.resolve(ctx.root, opts.desktop ?? `${opts.appDir}/${opts.executable}.desktop`),
    '--output',
    path.resolve(ctx.root, opts.output ?? `dist/${opts.executable}.AppImage`),
  ];
  if (opts.icon) args.push('--icon', path.resolve(ctx.root, opts.icon));
  if (opts.bundle) args.push('--bundle', path.resolve(ctx.root, opts.bundle));
  if (opts.noFetch) args.push('--no-fetch');
  await execa(scriptPath('appimage.sh'), args, {stdio: 'inherit', cwd: ctx.root});
}

async function packDeb(ctx: Config, opts: PackLinuxOpts) {
  // Pull defaults from the host project's package.json so users don't
  // have to repeat themselves.
  const pkg = readPkg(ctx.root);
  const name = opts.name ?? sanitizeDebName(pkg.name ?? opts.executable);
  const version = opts.version ?? pkg.version ?? '0.0.1';
  const description = opts.description ?? pkg.description ?? `${name} (react-native-linux app)`;
  const maintainer = opts.maintainer ?? formatMaintainer(pkg.author);
  const output = opts.output ?? `dist/${name}_${version}_amd64.deb`;

  const args = [
    '--app-dir',
    path.resolve(ctx.root, opts.appDir),
    '--executable',
    opts.executable,
    '--name',
    name,
    '--version',
    version,
    '--maintainer',
    maintainer,
    '--description',
    description,
    '--output',
    path.resolve(ctx.root, output),
  ];
  if (opts.desktop) args.push('--desktop', path.resolve(ctx.root, opts.desktop));
  if (opts.bundle) args.push('--bundle', path.resolve(ctx.root, opts.bundle));
  if (opts.vendorBundle) args.push('--vendor-bundle', path.resolve(ctx.root, opts.vendorBundle));
  if (opts.icon) args.push('--icon', path.resolve(ctx.root, opts.icon));
  if (opts.depends) args.push('--depends', opts.depends);

  await execa(scriptPath('deb.sh'), args, {stdio: 'inherit', cwd: ctx.root});
}

interface MinimalPkg {
  name?: string;
  version?: string;
  description?: string;
  author?: string | {name?: string; email?: string};
}

function readPkg(root: string): MinimalPkg {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

// dpkg-deb requires lowercase ASCII names without uppercase / slashes /
// scoped-package leading @.
function sanitizeDebName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[/_]/g, '-')
    .replace(/[^a-z0-9.+-]/g, '');
}

function formatMaintainer(author: MinimalPkg['author']): string {
  if (!author) return 'Unspecified <unspecified@example.invalid>';
  if (typeof author === 'string') return author;
  const name = author.name ?? 'Unspecified';
  const email = author.email ?? 'unspecified@example.invalid';
  return `${name} <${email}>`;
}

export const packLinux: Command = {
  name: 'pack-linux',
  description:
    'Bundle a built react-native-linux app into a distributable package (.deb or .AppImage).',
  options: [
    {
      name: '--target <format>',
      description: 'Packaging format: "deb" or "appimage"',
      default: 'deb',
    },
    {
      name: '--app-dir <path>',
      description: 'Directory containing the built executable',
      default: 'linux/build',
    },
    {
      name: '--executable <name>',
      description: 'Built executable filename inside --app-dir',
    },
    {
      name: '--output <path>',
      description: 'Output package path (default: dist/<name>_<version>_<arch>.<ext>)',
    },
    {
      name: '--name <name>',
      description: 'Package name (default: from package.json)',
    },
    {
      name: '--version <semver>',
      description: 'Package version (default: from package.json)',
    },
    {
      name: '--desktop <path>',
      description: 'Path to .desktop launcher (default: synthesized)',
    },
    {
      name: '--icon <path>',
      description: 'Path to a 256×256 PNG icon (optional)',
    },
    {
      name: '--bundle <path>',
      description: 'Path to the prebuilt JS bundle to include',
    },
    {
      name: '--vendor-bundle <path>',
      description: 'Path to the prebuilt vendor bundle (.bundle and/or .hbc)',
    },
    {
      name: '--maintainer <string>',
      description: '"Name <email>" for the deb Maintainer field',
    },
    {
      name: '--description <text>',
      description: 'One-line description (default: from package.json)',
    },
    {
      name: '--depends <csv>',
      description: 'Runtime apt dependencies (deb only)',
    },
    {
      name: '--no-fetch',
      description: 'AppImage only: skip downloading linuxdeploy / appimagetool',
    },
  ],
  // CommandFunction<Object> in @react-native-community/cli-types is too
  // permissive to express the opts shape here; cast through any to keep
  // PackLinuxOpts as the source of truth for the option list above.
  func: (async (_argv: string[], ctx: Config, rawOpts: unknown) => {
    const opts = rawOpts as PackLinuxOpts;
    if (!opts.executable) {
      throw new Error('--executable is required (filename of the built app binary).');
    }
    if (opts.target === 'appimage') {
      await packAppImage(ctx, opts);
    } else if (opts.target === 'deb') {
      await packDeb(ctx, opts);
    } else {
      throw new Error(`Unsupported --target "${opts.target}". Supported: "deb", "appimage".`);
    }
  }) as Command['func'],
};
