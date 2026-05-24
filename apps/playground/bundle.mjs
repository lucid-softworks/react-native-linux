#!/usr/bin/env node
// One-shot esbuild driver for the lightning-path React bundle. RN's CLI
// `bundle` command is currently flaky in our hoisted pnpm layout, so we
// drive esbuild directly for the playground.

import {build} from 'esbuild';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync} from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'linux/build/assets/index.linux.bundle');
mkdirSync(dirname(out), {recursive: true});

await build({
  entryPoints: [resolve(here, 'index.jsx')],
  bundle: true,
  // Hermes accepts a single concatenated script. IIFE is the safest
  // shape (no top-level `let`/`const` exposed to the global scope).
  format: 'iife',
  platform: 'neutral',
  // Hermes supports ES2018 reliably; ES2020 features like optional
  // chaining and nullish coalescing also work in current Hermes.
  target: 'es2020',
  outfile: out,
  loader: {'.js': 'jsx', '.jsx': 'jsx'},
  jsx: 'automatic',
  jsxImportSource: 'react',
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env.NODE_DEBUG': '""',
  },
  // react-reconciler imports `scheduler` etc — bundle them inline so the
  // resulting file has zero `require` calls at runtime.
  sourcemap: 'inline',
  legalComments: 'none',
  logLevel: 'info',
});

console.log(`✓ bundle → ${out}`);
