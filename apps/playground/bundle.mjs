#!/usr/bin/env node
// Two-bundle esbuild driver for the playground.
//
//   vendor.bundle  — React + react-reconciler + react-refresh + our
//                    runtime (shims, hostConfig, fabric, components).
//                    Loaded ONCE on cold start, never re-evaluated.
//   index.linux.bundle (a.k.a. app bundle) — index.tsx + any user
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
import {mkdirSync, readFileSync, writeFileSync, readFile, existsSync} from 'node:fs';
import {createConnection} from 'node:net';
import {spawnSync} from 'node:child_process';
import {transform as swcTransform} from '@swc/core';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'linux/build/assets');
mkdirSync(outDir, {recursive: true});

const vendorOut = resolve(outDir, 'vendor.bundle');
const appOut = resolve(outDir, 'index.linux.bundle');

const watch = process.argv.includes('--watch');

// react-refresh transform via @swc/core — about an order of magnitude
// faster than babel on a per-file basis, and refresh ships built-in
// (jsc.transform.react.refresh = true), no extra plugin install.
//
// We only run swc on user files (apps/playground), never on vendor
// (which would inject $RefreshReg$ into react-reconciler internals).
// esbuild filters use Go RE2 (no lookahead) so path screening happens
// inside the handler.
const refreshTransformPlugin = {
  name: 'react-refresh-swc',
  setup(b) {
    b.onLoad({filter: /\.(jsx?|tsx?)$/}, async (args) => {
      if (args.path.includes('/node_modules/')) return null;
      if (!args.path.includes('/apps/playground/')) return null;
      if (args.path.includes('/apps/playground/runtime/')) return null;
      const source = readFileSync(args.path, 'utf8');
      const isTs = args.path.endsWith('.ts') || args.path.endsWith('.tsx');
      const result = await swcTransform(source, {
        filename: args.path,
        sourceMaps: 'inline',
        jsc: {
          parser: isTs
            ? {syntax: 'typescript', tsx: args.path.endsWith('.tsx')}
            : {syntax: 'ecmascript', jsx: true},
          transform: {
            react: {
              runtime: 'automatic',
              // refresh is gated on development=true — swc only emits
              // $RefreshReg$/$RefreshSig$ calls when in dev mode.
              development: true,
              refresh: true,
            },
          },
          target: 'es2020',
        },
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
    // to its globalThis-qualified form. Same rewrite applies to the
    // $RefreshReg$/$RefreshSig$ globals that swc's refresh transform
    // emits in user code.
    '__REACT_DEVTOOLS_GLOBAL_HOOK__': 'globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__',
    '$RefreshReg$': 'globalThis.$RefreshReg$',
    '$RefreshSig$': 'globalThis.$RefreshSig$',
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

// Override via RN_ENTRY for one-off experiments (e.g. RN_ENTRY=expo-blank.tsx).
const appEntry = process.env.RN_ENTRY ?? 'index.tsx';
const appOpts = {
  ...baseOpts,
  entryPoints: [resolve(here, appEntry)],
  outfile: appOut,
  // These resolve at runtime from globalThis.__rnv (see banner).
  external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
             'react-reconciler', 'react-refresh/runtime',
             'react-native',
             '@react-native-async-storage/async-storage',
             'expo-status-bar',
             './runtime'],
  banner: {
    js:
      'var require = function(id) {\n' +
      '  var rnv = globalThis.__rnv;\n' +
      '  if (!rnv) throw new Error("vendor bundle not loaded");\n' +
      '  if (id === "react") return rnv.react;\n' +
      '  if (id === "react/jsx-runtime") return rnv.reactJsxRuntime;\n' +
      '  if (id === "react/jsx-dev-runtime") return rnv.reactJsxDevRuntime;\n' +
      '  if (id === "react-reconciler") return rnv.reactReconciler;\n' +
      '  if (id === "react-refresh/runtime") return rnv.reactRefreshRuntime;\n' +
      '  if (id === "react-native") return rnv.reactNative;\n' +
      '  if (id === "@react-native-async-storage/async-storage") return rnv.asyncStorage;\n' +
      '  if (id === "expo-status-bar") return rnv.expoStatusBar;\n' +
      '  if (id === "./runtime" || id === "./runtime/index") return rnv.runtime;\n' +
      '  if (id === "./fabric" || id === "./runtime/fabric") return rnv.runtime;\n' +
      '  throw new Error("unknown vendor require: " + id);\n' +
      '};\n',
  },
  plugins: [refreshTransformPlugin],
};

// Pre-compile the vendor bundle to Hermes bytecode. Hermes can execute
// .hbc directly (it auto-detects the magic header), skipping the
// parse/AST/codegen pass. For the 2.5 MB vendor that means cold-start
// JS init lands tens of milliseconds faster. We tolerate a missing
// hermesc — the C++ side falls back to evaluating the JS bundle.
function compileVendorBytecode() {
  const hermescCandidates = [
    resolve(here, '../../vnext/build/bin/hermesc'),
    resolve(here, '../../node_modules/react-native/sdks/hermesc/linux64-bin/hermesc'),
    resolve(here, '../../node_modules/react-native/sdks/hermesc/osx-bin/hermesc'),
  ];
  const hermesc = hermescCandidates.find(existsSync);
  if (!hermesc) {
    console.log('[hermesc] not found — vendor stays as JS source');
    return;
  }
  const vendorHbc = vendorOut + '.hbc';
  const t0 = performance.now();
  const r = spawnSync(hermesc, ['-emit-binary', '-O', '-out', vendorHbc, vendorOut],
                      {stdio: ['ignore', 'pipe', 'pipe']});
  if (r.status !== 0) {
    console.log(`[hermesc] failed (status ${r.status}): ${r.stderr?.toString().slice(0, 200)}`);
    return;
  }
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`✓ hermesc → ${vendorHbc} (${ms}ms)`);
}

async function once() {
  await build(vendorOpts);
  console.log(`✓ vendor → ${vendorOut}`);
  compileVendorBytecode();
  await build(appOpts);
  console.log(`✓ app    → ${appOut}`);
}

// Discover the playground's HMR socket. Same default the C++ side
// uses: $XDG_RUNTIME_DIR (fallback /tmp) + per-app filename.
function hmrSocketPath() {
  if (process.env.RN_HMR_SOCKET) return process.env.RN_HMR_SOCKET;
  const appId = 'works.lucidsoft.RNLinuxPlayground';
  const dir = process.env.XDG_RUNTIME_DIR || '/tmp';
  return `${dir}/rn-linux.${appId}.sock`;
}

// Push a bundle directly to the running playground over the Unix
// socket the C++ side opened in startHmrSocket(). Fire-and-forget; if
// the socket isn't there yet (cold start) we silently skip — the
// file-monitor reload path will still pick up the disk write as a
// fallback.
function pushBundleOverSocket(bytes) {
  return new Promise((resolveP) => {
    const sock = hmrSocketPath();
    const c = createConnection(sock);
    let done = false;
    const finish = (msg) => {
      if (done) return;
      done = true;
      try { c.destroy(); } catch {}
      resolveP(msg);
    };
    c.once('error', (err) => finish(`socket error: ${err.code || err.message}`));
    c.once('connect', () => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(bytes.length, 0);
      c.write(len);
      c.write(bytes);
      c.end();
    });
    c.once('close', () => finish('pushed'));
  });
}

async function watchMode() {
  // Vendor is built once — it doesn't depend on user code.
  await build(vendorOpts);
  console.log(`✓ vendor → ${vendorOut} (one-shot)`);
  compileVendorBytecode();
  // Wrap with timing + HMR-push hooks so we can both report rebuild
  // duration and shove the new bundle into the live playground over
  // a Unix socket (the C++ side listens; see startHmrSocket).
  const hmrPlugin = {
    name: 'hmr-push',
    setup(b) {
      let start = 0;
      b.onStart(() => { start = performance.now(); });
      b.onEnd(async (result) => {
        if (result.errors && result.errors.length) {
          console.log(`[watch] rebuild failed in ${(performance.now() - start).toFixed(1)}ms`);
          return;
        }
        const buildMs = (performance.now() - start).toFixed(1);
        const t1 = performance.now();
        // esbuild already wrote the bundle to disk (write: true by
        // default). Read it back as bytes; in a future iteration we
        // could keep it in-memory via write: false + outputFiles.
        readFile(appOut, async (err, bytes) => {
          if (err) {
            console.log(`[watch] rebuild ${buildMs}ms (push skipped: ${err.code})`);
            return;
          }
          const pushResult = await pushBundleOverSocket(bytes);
          const pushMs = (performance.now() - t1).toFixed(1);
          console.log(`[watch] rebuild ${buildMs}ms · push ${pushMs}ms (${pushResult})`);
        });
      });
    },
  };
  const ctx = await context({...appOpts, plugins: [...appOpts.plugins, hmrPlugin]});
  await ctx.watch();
  console.log(`👀 watching ${resolve(here, 'index.tsx')} → ${appOut}`);
  console.log(`📡 HMR push: ${hmrSocketPath()}`);
}

if (watch) {
  await watchMode();
} else {
  await once();
}
