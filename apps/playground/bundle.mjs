#!/usr/bin/env node
// Two-bundle esbuild driver for the playground.
//
//   vendor.bundle  — React + react-reconciler + react-refresh + our
//                    runtime (shims, hostConfig, fabric, components).
//                    Loaded ONCE on cold start, never re-evaluated.
//   index.linux.bundle (a.k.a. app bundle) — index.jsx + any user
//                    code. Re-evaluated on every save; Fast Refresh
//                    picks up the new component types and reconciles
//                    against the same React tree, preserving state.
//
// The app bundle imports React etc. via a tiny require() shim
// (banner below) that resolves from `globalThis.__rnv` — vendor's
// public table.

import {build, context} from 'esbuild';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync, readFileSync} from 'node:fs';
import babel from '@babel/core';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'linux/build/assets');
mkdirSync(outDir, {recursive: true});

const vendorOut = resolve(outDir, 'vendor.bundle');
const appOut = resolve(outDir, 'index.linux.bundle');

const watch = process.argv.includes('--watch');

// react-refresh babel transform — only on user files (apps/playground),
// never on the vendor side (which would inject $RefreshReg$ into
// react-reconciler internals). esbuild filters use Go RE2 (no lookahead)
// so we screen paths inside the handler.
const refreshTransformPlugin = {
  name: 'react-refresh-babel',
  setup(b) {
    b.onLoad({filter: /\.(jsx?|tsx?)$/}, (args) => {
      if (args.path.includes('/node_modules/')) return null;
      if (!args.path.includes('/apps/playground/')) return null;
      // The runtime/* files are vendor and shouldn't be transformed.
      if (args.path.includes('/apps/playground/runtime/')) return null;
      const source = readFileSync(args.path, 'utf8');
      const result = babel.transformSync(source, {
        filename: args.path,
        babelrc: false,
        configFile: false,
        presets: [['@babel/preset-react', {runtime: 'automatic'}]],
        plugins: [
          // Address $RefreshReg$/$RefreshSig$ via globalThis so the
          // bare-identifier lookup doesn't ReferenceError inside the
          // strict IIFE esbuild emits.
          ['react-refresh/babel', {
            skipEnvCheck: true,
            refreshReg: 'globalThis.$RefreshReg$',
            refreshSig: 'globalThis.$RefreshSig$',
          }],
        ],
      });
      return {contents: result.code, loader: 'js'};
    });
  },
};

// Shared esbuild config.
const baseOpts = {
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  define: {
    // react-refresh requires NODE_ENV !== 'production' to enable its
    // patch points. Use 'development' for both bundles so the refresh
    // hooks fire and react-reconciler's dev path runs.
    'process.env.NODE_ENV': '"development"',
    'process.env.NODE_DEBUG': '""',
    // Hermes strict mode doesn't expose globalThis properties via
    // bare-identifier lookup, so react-reconciler's
    // `typeof __REACT_DEVTOOLS_GLOBAL_HOOK__` returns 'undefined' and
    // skips Fast Refresh registration. Rewrite every bare reference
    // to its globalThis-qualified form.
    '__REACT_DEVTOOLS_GLOBAL_HOOK__': 'globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__',
  },
  loader: {'.js': 'jsx', '.jsx': 'jsx'},
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap: 'inline',
  legalComments: 'none',
  logLevel: 'info',
};

const vendorOpts = {
  ...baseOpts,
  entryPoints: [resolve(here, 'runtime/vendor.js')],
  outfile: vendorOut,
};

const appOpts = {
  ...baseOpts,
  entryPoints: [resolve(here, 'index.jsx')],
  outfile: appOut,
  // These resolve at runtime from globalThis.__rnv (see banner).
  external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
             'react-reconciler', 'react-refresh/runtime',
             './runtime'],
  banner: {
    js:
      'var require = function(id) {\n' +
      '  var rnv = globalThis.__rnv;\n' +
      '  if (!rnv) throw new Error("vendor bundle not loaded");\n' +
      '  if (id === "react") return rnv.react;\n' +
      '  if (id === "react/jsx-runtime" || id === "react/jsx-dev-runtime") return rnv.reactJsxRuntime;\n' +
      '  if (id === "react-reconciler") return rnv.reactReconciler;\n' +
      '  if (id === "react-refresh/runtime") return rnv.reactRefreshRuntime;\n' +
      '  if (id === "./runtime" || id === "./runtime/index") return rnv.runtime;\n' +
      '  if (id === "./fabric" || id === "./runtime/fabric") return rnv.runtime;\n' +
      '  throw new Error("unknown vendor require: " + id);\n' +
      '};\n',
  },
  plugins: [refreshTransformPlugin],
};

async function once() {
  await build(vendorOpts);
  console.log(`✓ vendor → ${vendorOut}`);
  await build(appOpts);
  console.log(`✓ app    → ${appOut}`);
}

async function watchMode() {
  // Vendor is built once — it doesn't depend on user code.
  await build(vendorOpts);
  console.log(`✓ vendor → ${vendorOut} (one-shot)`);
  const ctx = await context(appOpts);
  await ctx.watch();
  console.log(`👀 watching ${resolve(here, 'index.jsx')} → ${appOut}`);
}

if (watch) {
  await watchMode();
} else {
  await once();
}
