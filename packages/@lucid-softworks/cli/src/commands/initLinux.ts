import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import type {Command, Config} from '@react-native-community/cli-types';
import {deriveAppName, deriveApplicationId, projectConfig} from '../platformConfig';

// Files we substitute placeholders into when copying. Anything not on
// this list is copied byte-for-byte (binary assets, icons, …). Kept
// narrow so a stray __RNL_*__ token in unrelated content can't surprise
// the user.
const SUBSTITUTABLE_FILES = new Set(['main.cpp', 'app.desktop', 'CMakeLists.txt']);

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
  // See packLinux.ts: CommandFunction<Object> can't express our opts shape.
  func: (async (_argv: string[], ctx: Config, rawOpts: unknown) => {
    const opts = rawOpts as {overwrite: boolean};
    const target = path.join(ctx.root, 'linux');
    if (fs.existsSync(target) && !opts.overwrite) {
      console.error(
        chalk.red(`linux/ already exists at ${target}. Pass --overwrite to replace it.`),
      );
      process.exit(1);
    }
    const source = path.resolve(__dirname, '..', '..', 'templates', 'linux');
    if (!fs.existsSync(source)) {
      throw new Error(`CLI template missing at ${source}. Did the package install correctly?`);
    }

    const replacements = resolveReplacements(ctx);
    await copyWithSubstitutions(source, target, replacements);

    console.log(chalk.green(`✓ Wrote linux/ project at ${target}`));
    console.log(
      chalk.gray(
        `  applicationId: ${replacements.__RNL_APP_ID__}\n` +
          `  windowTitle:   ${replacements.__RNL_APP_NAME__}\n` +
          `  executable:    ${replacements.__RNL_EXECUTABLE__}`,
      ),
    );
    console.log(chalk.gray('  Next: cd linux && cmake -B build -G Ninja && cmake --build build'));
  }) as Command['func'],
};

function resolveReplacements(ctx: Config): Record<string, string> {
  const appName = deriveAppName(ctx.root);
  const appId = deriveApplicationId(ctx.root);
  // `projectConfig` is the canonical executable-name path (handles
  // user overrides via the @react-native-community/cli config) — fall
  // back to a deterministic default when the linux project doesn't
  // yet exist (which is exactly the case during `init-linux`).
  const project = projectConfig(ctx.root, {});
  const executable = project?.executableName ?? 'rn-linux-app';
  return {
    __RNL_APP_NAME__: appName,
    __RNL_APP_ID__: appId,
    __RNL_EXECUTABLE__: executable,
  };
}

async function copyWithSubstitutions(
  source: string,
  target: string,
  replacements: Record<string, string>,
): Promise<void> {
  await fs.promises.mkdir(target, {recursive: true});
  const entries = await fs.promises.readdir(source, {withFileTypes: true});
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const dstPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyWithSubstitutions(srcPath, dstPath, replacements);
      continue;
    }
    if (SUBSTITUTABLE_FILES.has(entry.name)) {
      const original = await fs.promises.readFile(srcPath, 'utf8');
      const rendered = substitute(original, replacements);
      await fs.promises.writeFile(dstPath, rendered);
    } else {
      await fs.promises.copyFile(srcPath, dstPath);
    }
  }
}

function substitute(content: string, replacements: Record<string, string>): string {
  let out = content;
  for (const [token, value] of Object.entries(replacements)) {
    out = out.split(token).join(value);
  }
  return out;
}
