#!/usr/bin/env node
'use strict';

/**
 * react-native-linux codegen driver.
 *
 * Walks the JS package for `*NativeComponent.{ts,tsx,js}` (Fabric
 * components — still a stub, see Markers.h note below) and
 * `Native*.{ts,tsx,js}` (TurboModule specs), then drives
 * `@lucid-softworks/react-native-linux-codegen` to emit one C++
 * header per TM spec under `--output/specs/`.
 *
 * Output layout:
 *
 *   <output>/.codegen-stamp.json   — manifest CMake stamps on
 *   <output>/Markers.h             — kSpecCount marker header
 *   <output>/specs/<Native*>Spec.h — TurboModule abstract base
 *                                    classes (one per parsed module)
 *
 * Fabric component codegen is still stamp-only: building a Linux
 * variant of `GenerateComponentDescriptorH.js` is a separate piece of
 * work and the in-tree `vnext/src/fabric/` uses the upstream
 * components directly today.
 *
 * Exit codes:
 *    0  ok
 *    1  arg parsing
 *    2  package directory missing
 *    3  no specs found (warning, not failure)
 */

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {package: null, output: null, includeApp: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') args.package = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--include-app') args.includeApp = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(`Usage: codegen/run.js --package DIR --output DIR [--include-app]\n`);
      process.exit(0);
    }
  }
  return args;
}

function walkSpecs(rootDir) {
  /** @type {{native: string[], component: string[]}} */
  const hits = {native: [], component: []};
  if (!fs.existsSync(rootDir)) return hits;

  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
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
      } else if (entry.isFile()) {
        if (/NativeComponent\.(ts|tsx|js)$/.test(entry.name)) {
          hits.component.push(full);
        } else if (/^Native[A-Z][^.]*\.(ts|tsx|js)$/.test(entry.name)) {
          hits.native.push(full);
        }
      }
    }
  }
  hits.native.sort();
  hits.component.sort();
  return hits;
}

function loadGenerator() {
  // Resolve the generator package against the script's location so
  // this driver works regardless of cwd.
  // eslint-disable-next-line node/no-missing-require
  return require(
    path.join(
      __dirname,
      '..',
      '..',
      'packages',
      '@lucid-softworks',
      'react-native-linux-codegen',
      'lib',
    ),
  );
}

function generateHeaders(specs, outDir) {
  if (specs.length === 0) return [];
  const generator = loadGenerator();
  const specsDir = path.join(outDir, 'specs');
  return generator.writeFromFiles(specs, specsDir);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.package || !args.output) {
    console.error('Missing --package or --output. See --help.');
    process.exit(1);
  }
  if (!fs.existsSync(args.package)) {
    console.error(`Package directory not found: ${args.package}`);
    process.exit(2);
  }

  const {native, component} = walkSpecs(args.package);
  if (native.length === 0 && component.length === 0) {
    console.warn(`[codegen] no specs found under ${args.package}; emitting empty stamp.`);
  } else {
    if (native.length > 0) {
      console.log(`[codegen] discovered ${native.length} TurboModule spec(s):`);
      for (const s of native) {
        console.log(`  - ${path.relative(process.cwd(), s)}`);
      }
    }
    if (component.length > 0) {
      console.log(`[codegen] discovered ${component.length} Fabric component spec(s):`);
      for (const s of component) {
        console.log(`  - ${path.relative(process.cwd(), s)}`);
      }
    }
  }

  fs.mkdirSync(args.output, {recursive: true});

  // 1. TurboModule + Fabric component header emission via the Linux
  //    generator. Real C++ headers; CMake's
  //    add_dependencies(react_native_linux, react_native_linux_codegen)
  //    ensures vnext build picks them up.
  let writtenHeaders = [];
  try {
    writtenHeaders = generateHeaders([...native, ...component], args.output);
    if (writtenHeaders.length > 0) {
      console.log(`[codegen] wrote ${writtenHeaders.length} header(s):`);
      for (const h of writtenHeaders) {
        console.log(`  - ${path.relative(process.cwd(), h)}`);
      }
    }
  } catch (e) {
    console.error(`[codegen] header generation failed: ${e.message}`);
    if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
    process.exit(4);
  }

  // 2. Manifest + marker stamp. The CMake custom command's OUTPUT
  //    list keys on this file so a touched spec → fresh stamp →
  //    rebuild of the dependent C++ TU.
  const allSpecs = [...native, ...component];
  const manifest = {
    generatedAt: new Date().toISOString(),
    package: path.resolve(args.package),
    nativeSpecs: native.map(s => path.relative(args.package, s)),
    componentSpecs: component.map(s => path.relative(args.package, s)),
    generatedHeaders: writtenHeaders.map(h => path.relative(args.output, h)),
    notice:
      writtenHeaders.length > 0
        ? 'TurboModule header emission is live via @lucid-softworks/react-native-linux-codegen. ' +
          'Fabric component generators are still stub-only.'
        : 'Manifest only — no TurboModule specs found.',
  };
  fs.writeFileSync(
    path.join(args.output, '.codegen-stamp.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  const markerHeader = [
    '// Auto-generated by scripts/codegen/run.js. Do not edit.',
    '#pragma once',
    '',
    'namespace rnlinux::codegen {',
    `inline constexpr unsigned int kSpecCount = ${allSpecs.length}u;`,
    `inline constexpr unsigned int kTurboModuleCount = ${native.length}u;`,
    `inline constexpr unsigned int kComponentCount = ${component.length}u;`,
    '} // namespace rnlinux::codegen',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(args.output, 'Markers.h'), markerHeader);
}

main();
