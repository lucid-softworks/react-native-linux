#!/usr/bin/env node
// Smoke test for the linux-platform resolveRequest interception. Loads
// apps/playground/metro.config.js, bundles a tiny entry that imports
// `expo-status-bar`, and asserts the bundled output contains the shim's
// signature exports — proof that Metro routed the bare specifier to
// `@lucid-softworks/react-native-linux-expo/expo-status-bar` rather
// than the real Expo package (which isn't installed here anyway).
//
// Run from the repo root: `node scripts/test-metro-resolve.mjs`
//
// Same logic should be re-runnable for every shim we migrate.

import Metro from 'metro';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const projectRoot = path.join(repoRoot, 'apps/playground');
const entry = path.join(projectRoot, '__test_metro_resolve__/entry.js');
const out = path.join(projectRoot, '__test_metro_resolve__/out.bundle.js');

const config = await Metro.loadConfig({cwd: projectRoot});

await Metro.runBuild(config, {
  entry,
  out,
  platform: 'linux',
  dev: true,
  minify: false,
  sourceMap: false,
});

const bundle = fs.readFileSync(out, 'utf8');
const needle = 'setStatusBarTranslucent';
if (!bundle.includes(needle)) {
  console.error(`✗ expected ${needle} in ${out} — Metro did not route to the shim`);
  process.exit(1);
}

console.log(
  `✓ Metro routed expo-status-bar → umbrella shim (${needle} present in bundle, ${bundle.length} bytes)`,
);
