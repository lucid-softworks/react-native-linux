import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import type {Command, Config} from '@react-native-community/cli-types';
import type {LinuxDependencyConfig} from '../platformConfig';

interface AutolinkLinuxOpts {
  outputFile: string;
  check: boolean;
}

interface LinkedDependency {
  name: string;
  sourceDir: string;
  cmakeTarget: string;
  // Populated only when the dep ships a NativeModule codegen config.
  // The autolink command runs the Linux generator over the dep's
  // spec files and records where the headers landed so the emitted
  // CMake can target_include_directories them onto the dep's
  // cmakeTarget.
  codegen?: {
    specs: string[];
    outputDir: string;
    moduleNames: string[];
  };
}

interface CodegenConfigShape {
  // RN's standard package.json key. Both `codegenConfig` and the
  // nested shape are optional; we treat any presence as opt-in.
  type?: 'modules' | 'components' | 'all';
  name?: string;
  jsSrcsDir?: string;
  // We don't honour the iOS/Android-specific subfields — the Linux
  // generator drives off the same spec files regardless.
}

/**
 * `autolink-linux`
 *
 * Walks `ctx.dependencies` looking for entries whose `platforms.linux` is a
 * non-null `LinuxDependencyConfig`, then emits a CMake include file that
 * pulls each one in via `add_subdirectory` and links it into the host app
 * target.
 *
 * Also drives the Linux TurboModule code generator
 * (`@lucid-softworks/react-native-linux-codegen`) for any dep whose
 * `package.json` carries a `codegenConfig`. The generated headers land
 * under `<autolinked-parent>/codegen/<dep-name>/specs/` and the emitted
 * CMake adds them to the dep's `cmakeTarget` include path.
 *
 * The generated file is consumed by the app's `linux/CMakeLists.txt` like:
 *
 *     include(${CMAKE_CURRENT_SOURCE_DIR}/build/autolinked.cmake OPTIONAL)
 *     ...
 *     target_link_libraries(rn-linux-app PRIVATE ${RN_LINUX_AUTOLINKED_TARGETS})
 *
 * The `--check` flag short-circuits writing and exits non-zero if the
 * existing file is out of date (CI guardrail).
 */
export const autolinkLinux: Command = {
  name: 'autolink-linux',
  description: 'Generate a CMake include listing the autolinked native dependencies',
  options: [
    {
      name: '--output-file <path>',
      description: 'Where to write the generated CMake include',
      default: 'linux/build/autolinked.cmake',
    },
    {
      name: '--check',
      description: 'Exit non-zero if the output file is out of date',
      default: false,
    },
  ],
  // CommandFunction<Object> in @react-native-community/cli-types is too
  // permissive to express the opts shape; cast through unknown to keep
  // AutolinkLinuxOpts as the source of truth for the options list above.
  func: (async (_argv: string[], ctx: Config, rawOpts: unknown) => {
    const opts = rawOpts as AutolinkLinuxOpts;
    const linked = collectLinkedDependencies(ctx);
    const outPath = path.resolve(ctx.root, opts.outputFile);
    const codegenRoot = path.join(path.dirname(outPath), 'codegen');

    // In --check mode we don't run codegen; we just verify the
    // existing autolinked.cmake is in sync with the discovered
    // metadata. CI surfaces a stale checkout that way.
    if (opts.check) {
      const generated = renderCmake(linked);
      const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
      if (existing.trim() !== generated.trim()) {
        console.error(
          chalk.red(
            `✗ ${path.relative(ctx.root, outPath)} is out of date. ` +
              'Re-run `react-native autolink-linux`.',
          ),
        );
        process.exitCode = 1;
        return;
      }
      console.log(chalk.green(`✓ ${path.relative(ctx.root, outPath)} is up to date`));
      return;
    }

    // Drive the Linux codegen for any dep with a codegenConfig in
    // its package.json. Populates each dep's `codegen` field.
    for (const dep of linked) {
      const codegen = runCodegenForDep(ctx, dep, codegenRoot);
      if (codegen) {
        dep.codegen = codegen;
        console.log(
          chalk.green(
            `✓ codegen for ${dep.name}: ${codegen.moduleNames.length} TurboModule(s) ` +
              `→ ${path.relative(ctx.root, codegen.outputDir)}`,
          ),
        );
      }
    }

    const generated = renderCmake(linked);
    fs.mkdirSync(path.dirname(outPath), {recursive: true});
    fs.writeFileSync(outPath, generated);
    console.log(
      chalk.green(
        `✓ Wrote ${path.relative(ctx.root, outPath)} ` +
          `(${linked.length} linked native module${linked.length === 1 ? '' : 's'})`,
      ),
    );
  }) as Command['func'],
};

export function collectLinkedDependencies(ctx: Config): LinkedDependency[] {
  const out: LinkedDependency[] = [];
  const deps = (ctx.dependencies ?? {}) as Record<
    string,
    {root: string; platforms?: {linux?: LinuxDependencyConfig | null}}
  >;
  for (const name of Object.keys(deps).sort()) {
    const dep = deps[name];
    const linux = dep.platforms?.linux;
    if (!linux) continue;
    if (!linux.cmakeTarget) {
      console.warn(
        chalk.yellow(`! ${name} declares a linux platform but no cmakeTarget — skipping.`),
      );
      continue;
    }
    out.push({
      name,
      sourceDir: linux.sourceDir,
      cmakeTarget: linux.cmakeTarget,
    });
  }
  return out;
}

// Run the Linux TurboModule generator for a single dep if it ships a
// codegenConfig. Returns metadata for `renderCmake` to consume, or
// undefined when the dep is component-only / has no codegen config.
//
// Exported for tests; the real entry is the `func` above.
export function runCodegenForDep(
  ctx: Config,
  dep: LinkedDependency,
  codegenRoot: string,
): LinkedDependency['codegen'] {
  const depRoot = resolveDepRoot(ctx, dep.name);
  if (!depRoot) return undefined;

  const cfg = readCodegenConfig(depRoot);
  if (!cfg) return undefined;
  // Both `modules` and `components` are now supported; the generator
  // dispatches by schema type per spec. `all` and missing `type`
  // are accepted as catch-all.

  const jsSrcsDir = path.join(depRoot, cfg.jsSrcsDir ?? '.');
  const specs = findNativeSpecs(jsSrcsDir);
  if (specs.length === 0) return undefined;

  const safeName = dep.name.replace(/[^a-zA-Z0-9_]/g, '_');
  const outputDir = path.join(codegenRoot, safeName, 'specs');

  // Loaded lazily so the CLI doesn't pay the @react-native/codegen
  // parser cost when no deps need codegen.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const codegen = require('@lucid-softworks/react-native-linux-codegen');
  fs.mkdirSync(outputDir, {recursive: true});

  const moduleNames: string[] = [];
  for (const specPath of specs) {
    try {
      const generated = codegen.generateFromFile(specPath) as Array<{
        filename: string;
        contents: string;
        moduleName: string;
      }>;
      for (const g of generated) {
        fs.writeFileSync(path.join(outputDir, g.filename), g.contents);
        moduleNames.push(g.moduleName);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        chalk.yellow(
          `! codegen skipped ${path.relative(ctx.root, specPath)} for ${dep.name}: ${msg}`,
        ),
      );
    }
  }

  if (moduleNames.length === 0) return undefined;
  return {specs, outputDir, moduleNames};
}

function resolveDepRoot(ctx: Config, name: string): string | undefined {
  const dep = (ctx.dependencies as Record<string, {root?: string}> | undefined)?.[name];
  return dep?.root;
}

function readCodegenConfig(depRoot: string): CodegenConfigShape | undefined {
  const pkgPath = path.join(depRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const cfg = pkg?.codegenConfig;
    if (cfg && typeof cfg === 'object') return cfg as CodegenConfigShape;
  } catch {
    /* malformed package.json — treat as no codegen */
  }
  return undefined;
}

function findNativeSpecs(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const hits: string[] = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (
        entry.isFile() &&
        (/^Native[A-Z][^.]*\.(ts|tsx|js)$/.test(entry.name) ||
          /NativeComponent\.(ts|tsx|js)$/.test(entry.name))
      ) {
        hits.push(full);
      }
    }
  }
  return hits.sort();
}

export function renderCmake(linked: LinkedDependency[]): string {
  const lines: string[] = [];
  lines.push('# Auto-generated by @lucid-softworks/react-native-linux-cli');
  lines.push('# Re-run `react-native autolink-linux` after adding or removing');
  lines.push('# native dependencies. Do not edit by hand.');
  lines.push('');
  lines.push('set(RN_LINUX_AUTOLINKED_TARGETS "")');
  for (const dep of linked) {
    const cleaned = dep.name.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push('');
    lines.push(`# ${dep.name}`);
    lines.push(`add_subdirectory("${dep.sourceDir}" rn_linux_dep_${cleaned})`);
    lines.push(`list(APPEND RN_LINUX_AUTOLINKED_TARGETS ${dep.cmakeTarget})`);
    if (dep.codegen) {
      lines.push(
        `target_include_directories(${dep.cmakeTarget} PRIVATE "${dep.codegen.outputDir}")`,
      );
      lines.push(`#   modules: ${dep.codegen.moduleNames.join(', ')}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
