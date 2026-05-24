#!/usr/bin/env node
// One-shot and watch-mode esbuild driver for the lightning-path React
// bundle. RN's CLI `bundle` command is currently flaky in our hoisted
// pnpm layout, so we drive esbuild directly for the playground.
//
// Usage:
//   node bundle.mjs            # one-shot build
//   node bundle.mjs --watch    # rebundle on every JS/JSX change

import {build, context} from 'esbuild';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'linux/build/assets/index.linux.bundle');
mkdirSync(dirname(out), {recursive: true});

const watch = process.argv.includes('--watch');

const opts = {
  entryPoints: [resolve(here, 'index.jsx')],
  bundle: true,
  // Hermes accepts a single concatenated script; IIFE keeps top-level
  // let/const off the global scope.
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  outfile: out,
  loader: {'.js': 'jsx', '.jsx': 'jsx'},
  jsx: 'automatic',
  jsxImportSource: 'react',
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NODE_DEBUG': '""',
  },
  sourcemap: 'inline',
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log(`👀 watching ${resolve(here, 'index.jsx')} → ${out}`);
  // esbuild's watcher keeps the event loop alive; the process stays up
  // until SIGINT/SIGTERM.
} else {
  await build(opts);
  console.log(`✓ bundle → ${out}`);
}
