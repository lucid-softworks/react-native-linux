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
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readFile,
  readdirSync,
  existsSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import {createConnection} from 'node:net';
import {spawnSync} from 'node:child_process';
import {transform as swcTransform} from '@swc/core';
import flowRemoveTypes from 'flow-remove-types';

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
// .svg imports resolve to a tiny React component that renders a
// labeled <View> at the requested width/height. Real handling needs
// react-native-svg-transformer (parses SVG into a react-native-svg
// component tree) — out of scope here. The component uses the
// react-native-svg shim already in vendor so transform/opacity props
// still pass through.
const svgPlaceholderPlugin = {
  name: 'svg-placeholder',
  setup(b) {
    b.onResolve({filter: /\.svg$/}, args => ({
      path: args.path,
      namespace: 'svg-placeholder',
    }));
    b.onLoad({filter: /.*/, namespace: 'svg-placeholder'}, args => {
      const name = args.path
        .split('/')
        .pop()
        .replace(/\.svg$/, '');
      // Render a labeled <View>; size from the consumer-passed props,
      // colour-coded by the (untouched) fill prop so apps like with-
      // svg that pass fill="white" actually get a visible square.
      const src =
        "const React = require('react');\n" +
        "const {View, Text} = require('react-native');\n" +
        'function SvgPlaceholder(props) {\n' +
        '  const size = props.width != null ? props.width : 24;\n' +
        '  return React.createElement(View, {\n' +
        '    style: [{\n' +
        '      width: size,\n' +
        '      height: props.height != null ? props.height : size,\n' +
        "      backgroundColor: props.fill || '#94a3b8',\n" +
        "      alignItems: 'center',\n" +
        "      justifyContent: 'center',\n" +
        '      opacity: 0.4,\n' +
        '    }, props.style],\n' +
        "  }, React.createElement(Text, {style: {fontSize: 8, color: '#0f172a'}}, '" +
        name +
        ".svg'));\n" +
        '}\n' +
        'module.exports = SvgPlaceholder;\n' +
        'module.exports.default = SvgPlaceholder;\n';
      return {contents: src, loader: 'js'};
    });
  },
};

// When EXPO_ROUTER_APP_ROOT is set in the bundler env, walk that dir,
// require() every *.{tsx,ts,jsx,js} file under it, and assign the
// resulting components to globalThis.__expoRouterRoutes keyed by their
// route path. The shim's <Stack>/<Slot> machinery already consumes that
// table — see lookupRoute() in expo-router.js. This is what
// `expo-router/entry` ends up importing (see expoRouterEntryRoutesShim
// below). Without it, the shim falls back to a static placeholder.
//
// Route keys mirror real expo-router: file path → URL segment, with
// `_layout` and group-segments (`(auth)/...`) preserved as-is. The
// keys the shim looks up:
//   /_layout           — root layout
//   /index             — root index route
//   /(tabs)/_layout    — tabs group layout
//   /(tabs)/profile    — tabs group profile leaf
const expoRouterRoutesPlugin = {
  name: 'expo-router-routes',
  setup(b) {
    const appRoot = process.env.EXPO_ROUTER_APP_ROOT || null;
    const virtualId = 'lucid-expo-router-routes';
    b.onResolve({filter: new RegExp('^' + virtualId + '$')}, () => ({
      path: virtualId,
      namespace: 'expo-router-routes',
    }));
    b.onLoad({filter: /.*/, namespace: 'expo-router-routes'}, () => {
      if (!appRoot || !existsSync(appRoot)) {
        // No app root configured: emit an empty manifest. The entry
        // checks for emptiness and falls back to the placeholder.
        return {
          contents: 'globalThis.__expoRouterRoutes = {};\nmodule.exports = {};',
          loader: 'js',
        };
      }
      // Walk the app dir. We accept tsx/ts/jsx/js, skip dotfiles, and
      // skip api routes (real expo-router treats `+api.ts` / `api/`
      // dirs as server-side handlers, we render the UI layer only).
      const files = [];
      const walk = dir => {
        for (const ent of readdirSync(dir, {withFileTypes: true})) {
          if (ent.name.startsWith('.')) continue;
          const p = resolve(dir, ent.name);
          if (ent.isDirectory()) {
            // skip directories that real expo-router treats as
            // non-route — `api/` (server handlers).
            if (ent.name === 'api') continue;
            walk(p);
          } else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) {
            // skip `+api.ts`-style server handlers.
            if (/^\+api\./.test(ent.name)) continue;
            // skip `_layout.web.tsx` web variants.
            if (/\.(web|native)\.(tsx|ts|jsx|js)$/.test(ent.name)) continue;
            files.push(p);
          }
        }
      };
      walk(appRoot);
      const routeKey = abs => {
        let rel = abs.slice(appRoot.length).replace(/\\/g, '/');
        if (!rel.startsWith('/')) rel = '/' + rel;
        return rel.replace(/\.(tsx|ts|jsx|js)$/, '');
      };
      // Each route is wrapped in try/catch so a broken module (one
      // whose top-level eval throws — common when a stubbed native
      // module's stub itself throws on init) only loses that route
      // instead of taking down the whole app. The failed route gets
      // a fallback component that renders an error view; the rest of
      // the route tree mounts cleanly.
      const fallbackName = '__expoRouterRouteFallback';
      const lines = files.map((f, i) => {
        const key = routeKey(f);
        return (
          'try {\n' +
          `  var r${i} = require(${JSON.stringify(f)});\n` +
          `  routes[${JSON.stringify(key)}] = r${i} && r${i}.default ? r${i}.default : r${i};\n` +
          '} catch (e' +
          i +
          ') {\n' +
          `  console.warn('[expo-router] route load failed for ${key}:', e${i} && e${i}.message);\n` +
          `  routes[${JSON.stringify(key)}] = ${fallbackName}(${JSON.stringify(key)}, e${i} && e${i}.message);\n` +
          '}'
        );
      });
      // Fallback component factory: returns a function component that
      // renders a small "route X failed to load" UI. Used by the
      // per-route try/catch wrapper above when a require throws.
      const fallbackSrc =
        "var __React = require('react');\n" +
        "var __RN = require('react-native');\n" +
        'function ' +
        fallbackName +
        '(routeKey, msg) {\n' +
        '  return function RouteLoadFailed() {\n' +
        '    return __React.createElement(\n' +
        '      __RN.View,\n' +
        "      {style: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fef2f2'}},\n" +
        "      __React.createElement(__RN.Text, {style: {color: '#7f1d1d', fontWeight: '600', marginBottom: 8}}, 'route ' + routeKey + ' failed to load'),\n" +
        "      __React.createElement(__RN.Text, {style: {color: '#991b1b', fontSize: 12, textAlign: 'center'}}, msg || ''),\n" +
        '    );\n' +
        '  };\n' +
        '}\n';
      const contents =
        'var routes = (globalThis.__expoRouterRoutes = globalThis.__expoRouterRoutes || {});\n' +
        fallbackSrc +
        lines.join('\n') +
        '\nmodule.exports = routes;\nmodule.exports.default = routes;\n';
      return {contents, loader: 'js', resolveDir: appRoot};
    });
  },
};

// TypeScript path-aliases (`@/components/foo`, `~/lib/auth`, ...) point
// at the example's source tree but esbuild doesn't read tsconfig.json
// for non-entry-tsconfig builds. Mirror the convention every
// expo/examples ships: `@/*` (and `~/*`) resolve relative to the
// directory that owns `src/`. For us that's the parent of
// EXPO_ROUTER_APP_ROOT (the app/ dir lives one level under src/), so
// `@/tw` lands at `<parent>/tw` (or `<parent>/tw/index.tsx`, esbuild
// extension-resolves the rest).
//
// Runs BEFORE the stub-unresolved plugin so legitimate path aliases
// don't get a Proxy stub.
const tsPathAliasPlugin = {
  name: 'ts-path-aliases',
  setup(b) {
    const appRoot = process.env.EXPO_ROUTER_APP_ROOT || null;
    if (!appRoot) return;
    // `<appRoot>/..` is `src/`. `<appRoot>/../..` is the example dir
    // (where tsconfig lives). Most templates use `@/*` → `src/*` so we
    // resolve aliases against the `src/` parent of the app dir.
    const srcRoot = resolve(appRoot, '..');
    b.onResolve({filter: /^(@|~)\//}, args => {
      const rel = args.path.replace(/^(@|~)\//, '');
      const candidate = resolve(srcRoot, rel);
      // Probe candidate.tsx / .ts / .jsx / .js / index.tsx etc.
      const variants = [
        candidate + '.tsx',
        candidate + '.ts',
        candidate + '.jsx',
        candidate + '.js',
        resolve(candidate, 'index.tsx'),
        resolve(candidate, 'index.ts'),
        resolve(candidate, 'index.jsx'),
        resolve(candidate, 'index.js'),
      ];
      for (const v of variants) {
        if (existsSync(v) && statSync(v).isFile()) {
          return {path: v};
        }
      }
      // No match — let other plugins (incl. the stub fallback) handle.
      return null;
    });
  },
};

// Last-resort import resolver. When an example imports a bare module
// (next-themes, zeego, clsx, …) that isn't in node_modules and isn't
// shimmed in our umbrella package, esbuild normally errors out and the
// whole bundle fails. For the smoke-matrix / playground demo path
// that's a hostile failure mode — one unresolved widget shouldn't take
// out the entire route tree.
//
// This plugin runs LAST in the chain (registered after every real
// resolver). For any bare specifier still unresolved at that point it
// emits a no-op stub: every property access returns a chainable Proxy
// that's also callable, so `next-themes.useTheme()`, `<ThemeProvider/>`,
// `Stripe.charges.create({...})` all silently degrade without runtime
// crashes. The matched module is logged once so the dev triage path
// stays visible.
const stubUnresolvedPlugin = {
  name: 'stub-unresolved-bare-imports',
  setup(b) {
    const NS = 'stub-unresolved';
    const logged = new Set();
    // Bare specifier = doesn't start with `.` or `/`. We skip `node:`
    // built-ins and skip anything we've explicitly externalised (the
    // banner shim already routes those via globalThis.__rnv).
    // Walk up from the importer's dir looking for
    // node_modules/<pkg>/package.json. Cheap and async-free; avoids
    // calling b.resolve (which would re-enter our own onResolve and
    // deadlock esbuild's worker pool — confirmed by inspecting
    // goroutine traces from a crashed run).
    const pkgRoot = process.cwd();
    // Anything declared external (react, react-native, the expo
    // umbrella, expo-router…) is routed via the vendor banners
    // globalThis.__rnv table at runtime. Those aren't in node_modules
    // necessarily, so we must skip them here or we'd wrongly stub them.
    const externalSet = new Set((b.initialOptions.external || []).map(String));
    function topPkgName(spec) {
      // Scoped: '@scope/pkg' → '@scope/pkg'. Unscoped: 'foo/bar' → 'foo'.
      if (spec[0] === '@') {
        const parts = spec.split('/');
        return parts.slice(0, 2).join('/');
      }
      return spec.split('/')[0];
    }
    function isResolvable(spec, fromFile) {
      const top = topPkgName(spec);
      // Repo-root check first — covers virtual namespaces whose
      // `importer` isn't a real filesystem path, and the common case
      // of a top-level node_modules install.
      if (existsSync(resolve(pkgRoot, 'node_modules', top, 'package.json'))) {
        return true;
      }
      // Walk up from the importer's dir for pnpm-style nested
      // node_modules under apps/* / packages/*.
      let dir = fromFile && fromFile[0] === '/' ? dirname(fromFile) : pkgRoot;
      while (dir && dir !== '/' && dir.length >= pkgRoot.length) {
        if (existsSync(resolve(dir, 'node_modules', top, 'package.json'))) {
          return true;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return false;
    }
    // For each stubbed module, track the set of named imports the
    // consumers reach for. esbuild's __toESM (used for `import * as` /
    // `import default`) reads the Proxy's ownKeys list to decide what
    // to copy into the namespace — without seeding it with the right
    // names, namespaces land empty and accesses like
    // `ThemedText` (from a stubbed `@/components/themed-text`) read as
    // undefined and JSX dies with "Element type is invalid".
    const stubbedNames = new Map();
    // Inexpensive regex parse of an importer file: pulls names out of
    // both `import { A, B as C } from "X"` and `import D, {E} from "X"`
    // declarations whose source matches `spec`. We don't try to be a
    // full parser — comments / template-literal-as-spec edge cases
    // would slip through. For routine npm package shapes this catches
    // the common cases.
    const importNamesRe =
      /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*(?:,\s*)?)?(?:\{([^}]+)\})?\s*from\s*['"]([^'"]+)['"]/g;
    function harvestNames(importerFile, spec) {
      let txt;
      try {
        txt = readFileSync(importerFile, 'utf8');
      } catch (_) {
        return;
      }
      importNamesRe.lastIndex = 0;
      let m;
      while ((m = importNamesRe.exec(txt))) {
        if (m[3] !== spec) continue;
        const set = stubbedNames.get(spec) || new Set();
        if (m[1]) set.add('default'); // import X from ...
        if (m[2]) {
          for (const part of m[2].split(',')) {
            const name = part
              .trim()
              .split(/\s+as\s+/)[0]
              .trim();
            if (name) set.add(name);
          }
        }
        stubbedNames.set(spec, set);
      }
    }
    b.onResolve({filter: /^[^./]/}, args => {
      if (args.path.startsWith('node:')) return null;
      // External or external-subpath: defer to esbuild's external
      // handling. We can't just check exact membership because the
      // external list is the top-level package only (e.g. `expo` covers
      // `expo`, `expo/something`, but not deep aliases). The topPkgName
      // helper gives us the package portion.
      if (externalSet.has(args.path) || externalSet.has(topPkgName(args.path))) {
        return null;
      }
      // If the package exists in node_modules anywhere up the tree,
      // hand it back to the default resolver (return undefined). Only
      // intercept when the package truly isn't installed.
      if (isResolvable(args.path, args.importer)) return null;
      if (!logged.has(args.path)) {
        logged.add(args.path);
        console.log(`[bundle] stubbing unresolved bare import: ${args.path}`);
      }
      // Pull named-import bindings out of the importer source so the
      // stubs ownKeys list can advertise them. esbuilds __toESM
      // pipeline copies only listed keys into the namespace object.
      if (args.importer && args.importer[0] === '/') {
        harvestNames(args.importer, args.path);
      }
      // CSS-flavoured imports: tag the path so onLoad uses an empty
      // CSS body. Routing JS stub content into a CSS context blows up
      // esbuild's CSS parser.
      const looksCss =
        /\.(css|scss|sass|less|styl)$/.test(args.path) ||
        (args.importer && /\.(css|scss|sass|less|styl)$/.test(args.importer));
      return {
        path: args.path,
        namespace: NS,
        pluginData: {css: !!looksCss, spec: args.path},
      };
    });
    b.onLoad({filter: /.*/, namespace: NS}, args => {
      if (args.pluginData && args.pluginData.css) {
        return {contents: '', loader: 'css'};
      }
      const spec = args.pluginData && args.pluginData.spec;
      const namesSet = (spec && stubbedNames.get(spec)) || new Set();
      // Always include 'default' so `import X from ...` works.
      namesSet.add('default');
      return loadStubModule(Array.from(namesSet));
    });
    function loadStubModule(extraKeys) {
      // Pure-function stub strategy (no runtime Proxy). Every named
      // export from this stubbed module becomes its OWN function
      // component decorated with a one-deep set of sub-keys:
      //   * Common UI namespacing primitives (Root, Trigger, Provider…)
      //     for `<Dropdown.Trigger />` style nesting.
      //   * Common hook names so `obj.useSession()` etc. resolves to a
      //     callable function (returns null → `{data} = ...` gives
      //     data: undefined, default args kick in).
      // Calls to the function return null (not a stub Proxy) so React
      // doesnt spiral into infinite re-render when an example uses a
      // stubbed Provider as the layouts root component. Accessing an
      // unknown sub-key returns undefined, which lets `const {x = 0} =
      // useFoo()` apply its default — the patternmost expo examples
      // rely on for missing config.
      const subKeys = [
        // UI namespacing (Radix/Headless/Reach)
        'Root',
        'Trigger',
        'Portal',
        'Content',
        'Overlay',
        'Item',
        'Group',
        'Label',
        'Separator',
        'Anchor',
        'Action',
        'Cancel',
        'Close',
        'Title',
        'Description',
        'Provider',
        'Consumer',
        'Header',
        'Body',
        'Footer',
        'Input',
        'Field',
        'Form',
        'Slot',
        'List',
        'Tab',
        'Tabs',
        'Panel',
        'Sub',
        'Menu',
        'MenuItem',
        'Button',
        'Image',
        'Text',
        'View',
        // Common hooks attached to namespace objects
        'useSession',
        'useAuth',
        'useUser',
        'useUserSession',
        'useSignIn',
        'useSignUp',
        'useSignOut',
        'useQuery',
        'useMutation',
        'useSubscription',
        'useTheme',
        'useStyle',
        'useStyles',
        'useColorScheme',
        'useNavigation',
        'useRouter',
        'useLink',
        'useConfig',
        'useClient',
        'create',
        'createTheme',
        'styled',
        'css',
        'token',
        'tokens',
        // HTML-namespacing primitives — react-strict-dom and similar
        // libraries expose `html.div`, `html.h1`, etc. Without these
        // the chained access reads as undefined and JSX falls over.
        'div',
        'span',
        'p',
        'a',
        'img',
        'button',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'section',
        'article',
        'nav',
        'main',
        'aside',
        'pre',
        'code',
        'small',
        'strong',
        'em',
        'br',
        'hr',
        'table',
        'thead',
        'tbody',
        'tr',
        'td',
        'th',
      ];
      return {
        contents:
          "const React = require('react');\n" +
          "const {View} = require('react-native');\n" +
          'function makeStubFn() {\n' +
          '  // Use leafStub as the function body too — same heuristic\n' +
          '  // (config-arg → return a stub function for chained use,\n' +
          '  // props-arg → render a View). Without this, e.g.\n' +
          '  // createAuthClient(config) returns a View element rather\n' +
          '  // than a stub, so `authClient.useSession()` blows up.\n' +
          '  function S(arg0, arg1) {\n' +
          '    return leafStub(arg0, arg1);\n' +
          '  }\n' +
          '  var subs = ' +
          JSON.stringify(subKeys) +
          ';\n' +
          '  for (var i = 0; i < subs.length; i++) {\n' +
          // Hook-named exports (useQuery, useMutation, useSubscription,
          // useSession, …) overwhelmingly return tuples — userland does
          // `const [state, fn] = useX()` and the tuple is the
          // destructure shape urql / SWR / TanStack Query / Redux all
          // converged on. A leafStub for these returns makeStubFn() (a
          // bare function) which Hermes' array destructure trips on
          // with "iterator method is not callable". hookStub returns a
          // tuple-shaped Array that ALSO carries the property surface
          // so both patterns work.
          '    S[subs[i]] = /^use[A-Z]/.test(subs[i]) ? hookStub : leafStub;\n' +
          '  }\n' +
          '  return S;\n' +
          '}\n' +
          'function hookStub() {\n' +
          '  // State object every "fetcher" hook (useQuery, useMutation,\n' +
          '  // useSubscription) returns. Covers the urql / TanStack Query\n' +
          '  // / SWR / Apollo / Redux-Query union of property names so\n' +
          '  // destructured access like `data` / `fetching` / `loading` /\n' +
          '  // `error` / `isLoading` etc. all evaluate to something\n' +
          "  // sensible without throwing 'undefined'.\n" +
          '  var state = {\n' +
          '    data: null,\n' +
          '    fetching: false,\n' +
          '    loading: false,\n' +
          '    isLoading: false,\n' +
          '    isPending: false,\n' +
          '    isSuccess: false,\n' +
          '    isError: false,\n' +
          '    isFetching: false,\n' +
          '    error: null,\n' +
          '    status: "idle",\n' +
          '    refetch: function () {},\n' +
          '    mutate: function () {},\n' +
          '    reset: function () {},\n' +
          '  };\n' +
          '  // Real Array so Symbol.iterator works for destructure.\n' +
          '  var noop = function () {};\n' +
          '  var result = [state, noop, noop];\n' +
          '  // Mirror the state properties onto the array itself so\n' +
          '  // `const r = useX(); r.data` works for hooks userland\n' +
          '  // treats as single-value (useSession, useUser, useTheme).\n' +
          '  for (var k in state) result[k] = state[k];\n' +
          '  return result;\n' +
          '}\n' +
          'function leafStub(arg0, arg1) {\n' +
          '  // HOC-render: useFactory(Component, props, ...). Real\n' +
          '  // factories like useCssElement return\n' +
          '  // React.createElement(Component, props). Mirror that so the\n' +
          '  // consumers wrapper component (`<Wrapped>`) mounts via the\n' +
          '  // original component.\n' +
          "  var arg0IsComp = typeof arg0 === 'function' ||\n" +
          "    (arg0 && typeof arg0 === 'object' && arg0.$$typeof);\n" +
          "  if (arg0IsComp && arg1 && typeof arg1 === 'object') {\n" +
          '    return React.createElement(arg0, arg1);\n' +
          '  }\n' +
          '  if (arg0IsComp) return arg0;\n' +
          '  // Config-factory pattern: createAuthClient({...}),\n' +
          '  // createTRPCClient({...}), etc. Return a fresh stub function\n' +
          '  // so consumers `client.useSession()` lands on a callable.\n' +
          '  // JSX render passes a `props` object too — disambiguate by\n' +
          '  // shape: if children or style is set, treat as React props.\n' +
          '  if (\n' +
          '    arg0 != null &&\n' +
          "    typeof arg0 === 'object' &&\n" +
          '    !Array.isArray(arg0) &&\n' +
          '    arg0.children === undefined &&\n' +
          '    arg0.style === undefined &&\n' +
          '    arg0.key === undefined\n' +
          '  ) {\n' +
          '    return makeStubFn();\n' +
          '  }\n' +
          '  // Default render: arg0 is JSX props OR there are no args.\n' +
          '  return React.createElement(View, {style: arg0 && arg0.style}, arg0 && arg0.children);\n' +
          '}\n' +
          'var keys = ' +
          JSON.stringify(extraKeys) +
          ';\n' +
          'var defaultExport = makeStubFn();\n' +
          'for (var i = 0; i < keys.length; i++) {\n' +
          "  if (keys[i] === 'default') continue;\n" +
          // Same hook-name detection as inside makeStubFn. Without it,
          // an esbuild-detected named import like `useQuery` overwrites
          // the per-name slot makeStubFn() set up internally — with a
          // generic stub function instead of hookStub — so the
          // `const [state, fn] = useQuery(...)` destructure trips
          // "iterator method is not callable" again. Mirror the rule
          // here so default-export AND named-export entry points both
          // resolve hooks to a tuple-shaped value.
          '  defaultExport[keys[i]] = /^use[A-Z]/.test(keys[i]) ? hookStub : makeStubFn();\n' +
          '}\n' +
          'defaultExport.default = defaultExport;\n' +
          'module.exports = defaultExport;\n',
        loader: 'js',
      };
    }
  },
};

const refreshTransformPlugin = {
  name: 'react-refresh-swc',
  setup(b) {
    b.onLoad({filter: /\.(jsx?|tsx?)$/}, async args => {
      const inUserCode =
        args.path.includes('/apps/playground/') && !args.path.includes('/apps/playground/runtime/');
      // RN's codegen generates Native* spec files in .js extensions
      // that contain TypeScript / Flow syntax (`import type {...}`,
      // `interface Spec extends TurboModule { ... }`, `(expr: ?Type)`
      // casts). esbuild can't parse them as JSX.
      const isNativeSpec =
        args.path.includes('/node_modules/') && /\/Native[A-Z][A-Za-z0-9]*\.js$/.test(args.path);
      // Our umbrella shim package ships modern JS — `class MMKV { ... }`,
      // private fields, async methods. RN 0.81's bundled Hermes still
      // reports as 0.12 and its lazy-parse path silently drops
      // `var X = class { ... }` assignments (the var is hoisted, the
      // class expression never evaluates, so `module.exports.MMKV` ends
      // up undefined). Lower these files to ES5 alongside user code.
      const isShimPackage = args.path.includes(
        '/packages/@lucid-softworks/react-native-linux-expo/',
      );
      // Read once so we can both Flow-detect and class-detect without
      // hitting disk twice. Cheap: file fits in cache, swc handles
      // hundreds of files per second.
      let source = null;
      const lazySource = () => {
        if (source === null) source = readFileSync(args.path, 'utf8');
        return source;
      };
      // Third-party RN libraries that ship class-component code Hermes
      // 0.12 hard-rejects: `class extends X.Y` in expression position
      // (esbuild's `return _a = class extends import_react.PureComponent`
      // around static-field initializers). The source typically has
      // `class Foo extends PureComponent` — a simple identifier — but
      // esbuild rewrites `PureComponent` to `import_react.PureComponent`
      // during CJS bundling, producing the member-expression that
      // Hermes can't parse. Detect by content (any `class … extends …`
      // in a node_modules file) rather than by package name so new
      // libraries pick up the same handling. Routing matched files
      // through swc with ES5 target lowers classes to prototype-based
      // assignments Hermes accepts.
      const inNodeModules = args.path.includes('/node_modules/');
      // expo/examples is a sibling tree we vendor under
      // external/expo-examples/ via a git submodule; treat it like
      // node_modules for class-lowering purposes since esbuild can
      // still emit `var X = class extends Y.Z` from user code there.
      const inExternalExamples = args.path.includes('/external/expo-examples/');
      // Match any `class <Identifier>` declaration — Hermes 0.12
      // rejects both `class extends X.Y` (member-expression super)
      // and `class _X { ... }` (the renamed-binding form esbuild
      // emits for `var X = class { ... }`). The earlier
      // `class … extends …` filter missed the second case, which
      // showed up in expo-asset's AssetSourceResolver.
      const looksClassHeavy =
        (inNodeModules || inExternalExamples) &&
        !isShimPackage &&
        !isNativeSpec &&
        /\bclass\b\s+\w/.test(lazySource());
      if (!inUserCode && !isNativeSpec && !isShimPackage && !looksClassHeavy) return null;

      // RN's Native* spec files are usually Flow-flavoured (// @flow,
      // `interface Spec extends TurboModule`, `(expr: ?Type)` casts).
      // Strip Flow first so swc's TS parser doesn't choke. all=true
      // means "process even without a @flow pragma" since some files
      // forget it.
      if (isNativeSpec || /^\s*(\/\/|\/\*)\s*@flow/.test(lazySource())) {
        source = flowRemoveTypes(lazySource(), {all: true}).toString();
      }
      const isTs = args.path.endsWith('.ts') || args.path.endsWith('.tsx');
      const result = await swcTransform(lazySource(), {
        filename: args.path,
        sourceMaps: 'inline',
        jsc: {
          parser: isTs
            ? {syntax: 'typescript', tsx: args.path.endsWith('.tsx')}
            : {syntax: 'ecmascript', jsx: true},
          transform: {
            react: {
              runtime: 'automatic',
              development: true,
              refresh: inUserCode,
            },
          },
          // ES5 for the umbrella shim package AND any class-heavy
          // library we route through here (forces classes →
          // function-constructors so Hermes' lazy-parse drop and its
          // class-expression-in-assignment parser bug don't bite);
          // ES2020 elsewhere keeps async/arrow ergonomic for user code.
          target: isShimPackage || looksClassHeavy ? 'es5' : 'es2020',
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
  // Hermes (pinned to the RN 0.81 commit `e0fc6714`) hard-rejects every
  // `async` / `await` site with "async functions are unsupported" — both
  // the interpreter and hermesc fail to compile. Use esbuild's
  // per-feature `supported` knob to lower JUST async / async-generators
  // to generators, while keeping the rest of ES2020 (optional chaining,
  // nullish coalescing, object spread, …) intact. Without this RN apps
  // can't use `async () => …` anywhere — the README workaround
  // (`async function () {…}`) is also rejected; the runtime is fully
  // async-free until a Hermes that supports the syntax lands.
  supported: {
    'async-await': false,
    'async-generator': false,
  },
  define: {
    // react-refresh requires NODE_ENV !== 'production' to enable its
    // patch points. Use 'development' for both bundles so the refresh
    // hooks fire and react-reconciler's dev path runs.
    'process.env.NODE_ENV': '"development"',
    'process.env.NODE_DEBUG': '""',
    // Stub values for EXPO_PUBLIC_* env vars that expo/examples
    // examples typically check at module-eval time (with-convex
    // throws if its URL is missing). esbuild substitutes the
    // literal expression at bundle time so the check passes
    // regardless of the runtime process.env shape.
    'process.env.EXPO_PUBLIC_CONVEX_URL': '"https://stub.convex.cloud"',
    'process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY': '"pk_test_stub"',
    'process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY': '"pk_test_stub"',
    'process.env.EXPO_PUBLIC_SUPABASE_URL': '"https://stub.supabase.co"',
    'process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY': '"stub"',
    'process.env.EXPO_PUBLIC_API_URL': '"https://stub.api/"',
    // Hermes strict mode doesn't expose globalThis properties via
    // bare-identifier lookup, so react-reconciler's
    // `typeof __REACT_DEVTOOLS_GLOBAL_HOOK__` returns 'undefined' and
    // skips Fast Refresh registration. Rewrite every bare reference
    // to its globalThis-qualified form. Same rewrite applies to the
    // $RefreshReg$/$RefreshSig$ globals that swc's refresh transform
    // emits in user code.
    __REACT_DEVTOOLS_GLOBAL_HOOK__: 'globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__',
    $RefreshReg$: 'globalThis.$RefreshReg$',
    $RefreshSig$: 'globalThis.$RefreshSig$',
    // RN's standard dev-mode global. Real Metro setups inject this
    // into Hermes; third-party libs (expo-modules-core, lots of
    // react-native deps) reference it without `typeof` guards. Same
    // bare-identifier-vs-globalThis trap as above.
    __DEV__: 'true',
    // RN polyfills a `global` alias to globalThis. Third-party libs
    // (expo, react-native-device-info, …) reach for it without a
    // `typeof` guard. Hermes strict mode refuses bare unresolved
    // identifiers, so rewrite at bundle time.
    global: 'globalThis',
  },
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx',
    // RN's codegen Native* spec files (e.g. react-native/Libraries/.../
    // NativeXxx.js, react-native-vector-icons/lib/NativeRNVectorIcons.js)
    // are TypeScript dialect in a .js extension. Apply swc transform via
    // the plugin below instead of relying on a single loader for all
    // .js files. Assets get inlined as base64 data URLs so the bundle
    // is self-contained — fine for small icon PNGs the way paper /
    // navigation use them; switch to 'file' + an output asset manifest
    // for big binary blobs.
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.gif': 'dataurl',
    '.webp': 'dataurl',
    '.ttf': 'dataurl',
    // .svg: real handling needs react-native-svg-transformer to
    // parse the SVG into a React component. We instead handle them
    // via the svgPlaceholderPlugin below, which emits a tiny React
    // component that renders a labeled <View> at the requested
    // width/height — `empty` would resolve the import to {} and
    // React would throw "Element type is invalid" on
    // `<ExpoLogo width={...} />` because {} isn't a valid component.
    // No loader entry — onResolve+onLoad take over.
    '.otf': 'dataurl',
  },
  jsx: 'automatic',
  jsxImportSource: 'react',
  sourcemap: 'inline',
  legalComments: 'none',
  logLevel: 'info',
  // platform:'neutral' is the right choice (we're not browser, not
  // node) but it leaves mainFields unset, which means esbuild ignores
  // every package's "main" / "module" / "browser" / "react-native"
  // field. Most npm packages — including react-native-paper, react-
  // navigation, anything from the RN ecosystem — only export those
  // fields, so resolving any of them fails with "main field ignored
  // when using neutral platform". Set the RN-flavoured chain
  // explicitly: react-native > browser > module > main, matching
  // what Metro does.
  mainFields: ['react-native', 'browser', 'module', 'main'],
  conditions: ['react-native', 'browser', 'module', 'import', 'require', 'default'],
};

const vendorOpts = {
  ...baseOpts,
  entryPoints: [resolve(here, 'runtime/vendor.js')],
  outfile: vendorOut,
  // The umbrella shims now `require('react-native')` so they're
  // portable to Metro. esbuild would follow that into the real
  // react-native package and choke on its Flow `import typeof`
  // syntax. Redirect to the playground's own react-native shim
  // (runtime/react-native.js) before resolution walks node_modules.
  alias: {
    'react-native': resolve(here, 'runtime/react-native.js'),
  },
  // Same swc transform as appOpts uses — needed so the umbrella shim
  // files (under packages/@lucid-softworks/react-native-linux-expo/)
  // get lowered to ES5 and their `class X { ... }` definitions become
  // function constructors. Without this, Hermes' lazy-parse path
  // silently drops the class-expression assignment and any `new
  // MMKV()` from the app bundle blows up with "undefined is not a
  // function".
  plugins: [svgPlaceholderPlugin, refreshTransformPlugin],
};

// Override via RN_ENTRY for one-off experiments
// (e.g. RN_ENTRY=expo-blank.tsx — relative to apps/playground).
// For entries OUTSIDE the playground (smoke harness for
// external/expo-examples/* etc.), pass RN_ENTRY_PATH=<absolute path>
// — that bypasses the `resolve(here, …)` join entirely.
const appEntry = process.env.RN_ENTRY ?? 'index.tsx';
const externalEntry = process.env.RN_ENTRY_PATH ?? null;
const resolvedEntry = externalEntry ? resolve(externalEntry) : resolve(here, appEntry);
const appOpts = {
  ...baseOpts,
  entryPoints: [resolvedEntry],
  outfile: appOut,
  // These resolve at runtime from globalThis.__rnv (see banner).
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-reconciler',
    'react-refresh/runtime',
    'react-native',
    '@react-native-async-storage/async-storage',
    'react-native-device-info',
    'expo-modules-core',
    'expo',
    'expo-status-bar',
    'expo-font',
    'expo-splash-screen',
    'expo-web-browser',
    'expo-symbols',
    'expo-battery',
    'expo-camera',
    'expo-clipboard',
    'expo-constants',
    'expo-document-picker',
    'expo-file-system',
    'expo-haptics',
    'expo-image',
    'expo-image-picker',
    'expo-keep-awake',
    'expo-linking',
    'expo-localization',
    'expo-location',
    'expo-network',
    'expo-notifications',
    'expo-print',
    'expo-screen-capture',
    'expo-secure-store',
    'expo-sharing',
    'react-native-safe-area-context',
    'react-native-screens',
    'react-native-reanimated',
    'expo-router',
    'expo-router/entry',
    '@expo/metro-runtime',
    '@expo/vector-icons',
    '@expo/vector-icons/*',
    'zustand',
    'zustand/shallow',
    'expo-sqlite',
    '@react-navigation/native',
    '@react-navigation/native-stack',
    '@react-navigation/stack',
    '@react-navigation/drawer',
    '@react-navigation/bottom-tabs',
    '@react-navigation/material-top-tabs',
    '@react-navigation/material-bottom-tabs',
    '@react-navigation/elements',
    'moti',
    'expo-updates',
    'expo-av',
    '@sentry/react-native',
    'socket.io-client',
    'styled-components',
    'styled-components/native',
    'react-native-maps',
    'react-native-pdf',
    'react-native-webrtc',
    'react-native-svg',
    'react-native-svg/css',
    'victory-native',
    'react-router-dom',
    'react-router',
    'expo-asset',
    'expo-auth-session',
    'expo-auth-session/providers/google',
    'expo-auth-session/providers/facebook',
    'expo-auth-session/providers/apple',
    'jwt-decode',
    '@apollo/client',
    '@apollo/client/react',
    '@apollo/client/link/http',
    '@apollo/client/cache',
    'firebase/app',
    'firebase/auth',
    'firebase/auth/react-native',
    'firebase/firestore',
    'firebase/storage',
    '@react-native-picker/picker',
    'tinybase',
    'tinybase/ui-react',
    'tinybase/persisters/persister-browser',
    'tinybase/persisters/persister-expo-sqlite',
    '@legendapp/state',
    '@legendapp/state/react',
    '@legendapp/state/persist',
    '@legendapp/state/sync',
    '@legendapp/state/persist-plugins/async-storage',
    '@legendapp/state/sync-plugins/supabase',
    'three',
    'expo-gl',
    'expo-three',
    'expo-processing',
    '@magic-sdk/react-native',
    '@magic-sdk/react-native-bare',
    '@react-three/fiber',
    '@react-three/fiber/native',
    '@react-three/drei',
    'react-native-get-random-values',
    '@supabase/supabase-js',
    'aws-amplify',
    '@aws-amplify/core',
    '@aws-amplify/auth',
    '@aws-amplify/storage',
    '@tensorflow/tfjs',
    '@tensorflow/tfjs-react-native',
    '@tensorflow-models/mobilenet',
    'uuid',
    'crypto',
    'node:crypto',
    'expo-application',
    'expo-crypto',
    'expo-device',
    'expo-watermark',
    'expo-file-system/legacy',
    'react-native-mmkv',
    'react-native-css',
    'nativewind',
    '@react-native-community/netinfo',
    './runtime',
  ],
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
      '  if (id === "react-native-device-info") return rnv.deviceInfo;\n' +
      '  if (id === "expo-modules-core") return rnv.expoModulesCore;\n' +
      '  if (id === "expo") return rnv.expo;\n' +
      '  if (id === "expo-status-bar") return rnv.expoStatusBar;\n' +
      '  if (id === "expo-font") return rnv.expoFont;\n' +
      '  if (id === "expo-splash-screen") return rnv.expoSplashScreen;\n' +
      '  if (id === "expo-web-browser") return rnv.expoWebBrowser;\n' +
      '  if (id === "expo-symbols") return rnv.expoSymbols;\n' +
      '  if (id === "expo-constants") return rnv.expoConstants;\n' +
      '  if (id === "expo-battery") return rnv.expoBattery;\n' +
      '  if (id === "expo-camera") return rnv.expoCamera;\n' +
      '  if (id === "expo-clipboard") return rnv.expoClipboard;\n' +
      '  if (id === "expo-document-picker") return rnv.expoDocumentPicker;\n' +
      '  if (id === "expo-file-system") return rnv.expoFileSystem;\n' +
      '  if (id === "expo-haptics") return rnv.expoHaptics;\n' +
      '  if (id === "expo-image") return rnv.expoImage;\n' +
      '  if (id === "expo-image-picker") return rnv.expoImagePicker;\n' +
      '  if (id === "expo-keep-awake") return rnv.expoKeepAwake;\n' +
      '  if (id === "expo-linking") return rnv.expoLinking;\n' +
      '  if (id === "expo-localization") return rnv.expoLocalization;\n' +
      '  if (id === "expo-location") return rnv.expoLocation;\n' +
      '  if (id === "expo-network") return rnv.expoNetwork;\n' +
      '  if (id === "expo-notifications") return rnv.expoNotifications;\n' +
      '  if (id === "expo-print") return rnv.expoPrint;\n' +
      '  if (id === "expo-screen-capture") return rnv.expoScreenCapture;\n' +
      '  if (id === "expo-secure-store") return rnv.expoSecureStore;\n' +
      '  if (id === "expo-sharing") return rnv.expoSharing;\n' +
      '  if (id === "react-native-safe-area-context") return rnv.safeAreaContext;\n' +
      '  if (id === "react-native-screens") return rnv.screens;\n' +
      '  if (id === "react-native-reanimated") return rnv.reanimated;\n' +
      '  if (id === "expo-router") return rnv.expoRouter;\n' +
      '  if (id === "expo-router/entry") return rnv.expoRouterEntry();\n' +
      // Subpath catch-all: expo-router/unstable-native-tabs,
      // expo-router/build/..., etc. The base shim exposes Stack/Tabs/
      // Slot/Link/hooks — that's enough for most subpath imports
      // (the unstable-native-tabs one in with-shadcn just wants Tabs).
      '  if (id.indexOf("expo-router/") === 0) return rnv.expoRouter;\n' +
      '  if (id === "@expo/metro-runtime") return rnv.expoMetroRuntime;\n' +
      '  if (id === "crypto" || id === "node:crypto") return rnv.nodeCrypto;\n' +
      '  if (id === "zustand") return rnv.zustand;\n' +
      // zustand/middleware, zustand/vanilla, zustand/traditional — route
      // any subpath through the base shim. Unknown export names will be
      // undefined, callers either feature-test or fall to defaults.
      '  if (id.indexOf("zustand/") === 0 && id !== "zustand/shallow") return rnv.zustand;\n' +
      // zustand/shallow ships BOTH `import shallow from "zustand/shallow"`
      // (the function as default) AND `import {shallow} from "zustand/shallow"`.
      // Return an __esModule namespace that satisfies both shapes; esbuild
      // sees __esModule:true and pipes it through interop untouched.
      '  if (id === "zustand/shallow") {\n' +
      '    var sh = rnv.zustand.shallow;\n' +
      '    var ns = {default: sh, shallow: sh};\n' +
      '    Object.defineProperty(ns, "__esModule", {value: true});\n' +
      '    return ns;\n' +
      '  }\n' +
      '  if (id === "expo-sqlite") return rnv.expoSqlite;\n' +
      // Every @react-navigation/* package routes through the same
      // minimal shim — the navigator factories cover stack / native-
      // stack / drawer / bottom-tabs / material-* with one impl.
      '  if (id === "@react-navigation/native") return rnv.rnNavigation;\n' +
      '  if (id === "@react-navigation/native-stack") return {createNativeStackNavigator: rnv.rnNavigation.createNativeStackNavigator};\n' +
      '  if (id === "@react-navigation/stack") return {createStackNavigator: rnv.rnNavigation.createStackNavigator};\n' +
      '  if (id === "@react-navigation/drawer") return {createDrawerNavigator: rnv.rnNavigation.createDrawerNavigator};\n' +
      '  if (id === "@react-navigation/bottom-tabs") return {createBottomTabNavigator: rnv.rnNavigation.createBottomTabNavigator};\n' +
      '  if (id === "@react-navigation/material-top-tabs") return {createMaterialTopTabNavigator: rnv.rnNavigation.createMaterialTopTabNavigator};\n' +
      '  if (id === "@react-navigation/material-bottom-tabs") return {createMaterialBottomTabNavigator: rnv.rnNavigation.createMaterialBottomTabNavigator};\n' +
      '  if (id === "@react-navigation/elements") return {};\n' +
      '  if (id === "moti") return rnv.moti;\n' +
      '  if (id === "expo-updates") return rnv.expoUpdates;\n' +
      '  if (id === "expo-av") return rnv.expoAv;\n' +
      '  if (id === "@sentry/react-native") return rnv.sentry;\n' +
      '  if (id === "socket.io-client") return rnv.socketIo;\n' +
      '  if (id === "styled-components" || id === "styled-components/native") return rnv.styledComponents;\n' +
      '  if (id === "react-native-maps") return rnv.reactNativeMaps;\n' +
      '  if (id === "react-native-pdf") return rnv.reactNativePdf;\n' +
      '  if (id === "react-native-webrtc") return rnv.reactNativeWebrtc;\n' +
      '  if (id === "react-native-svg" || id === "react-native-svg/css") return rnv.reactNativeSvg;\n' +
      '  if (id === "victory-native") return rnv.victoryNative;\n' +
      '  if (id === "react-router-dom" || id === "react-router") return rnv.reactRouterDom;\n' +
      '  if (id === "expo-asset") return rnv.expoAsset;\n' +
      '  if (id === "expo-auth-session") return rnv.expoAuthSession;\n' +
      '  if (id.indexOf("expo-auth-session/providers/") === 0) {\n' +
      '    var prov = id.slice("expo-auth-session/providers/".length);\n' +
      '    return rnv.expoAuthSession.Providers[prov[0].toUpperCase()+prov.slice(1)] || rnv.expoAuthSession;\n' +
      '  }\n' +
      '  if (id === "jwt-decode") return rnv.jwtDecode;\n' +
      '  if (id === "@apollo/client" || id.indexOf("@apollo/client/") === 0) return rnv.apolloClient;\n' +
      '  if (id === "firebase/app") return rnv.firebase.app;\n' +
      '  if (id === "firebase/auth" || id === "firebase/auth/react-native") return rnv.firebase.auth;\n' +
      '  if (id === "firebase/firestore") return rnv.firebase.firestore;\n' +
      '  if (id === "firebase/storage") return rnv.firebase.storage;\n' +
      '  if (id === "@react-native-picker/picker") return rnv.reactNativePicker;\n' +
      '  if (id === "tinybase") return rnv.tinybase.base;\n' +
      '  if (id === "tinybase/ui-react") return rnv.tinybase.uiReact;\n' +
      '  if (id.indexOf("tinybase/persisters/") === 0) return rnv.tinybase.persisters;\n' +
      '  if (id === "@legendapp/state") return rnv.legendState.base;\n' +
      '  if (id === "@legendapp/state/react") return rnv.legendState.react;\n' +
      '  if (id === "@legendapp/state/persist") return rnv.legendState.persist;\n' +
      '  if (id === "@legendapp/state/sync") return rnv.legendState.sync;\n' +
      '  if (id === "@legendapp/state/persist-plugins/async-storage") return rnv.legendState.persistAsyncStorage;\n' +
      '  if (id === "@legendapp/state/sync-plugins/supabase") return rnv.legendState.syncSupabase;\n' +
      '  if (id === "three") return rnv.expoGlThree.three;\n' +
      '  if (id === "expo-gl") return rnv.expoGlThree.expoGl;\n' +
      '  if (id === "expo-three") return rnv.expoGlThree.expoThree;\n' +
      '  if (id === "expo-processing") return rnv.expoGlThree.expoProcessing;\n' +
      '  if (id === "@magic-sdk/react-native" || id === "@magic-sdk/react-native-bare") return rnv.misc.magicSdk;\n' +
      '  if (id === "@react-three/fiber" || id === "@react-three/fiber/native" || id === "@react-three/drei") return rnv.misc.reactThreeFiber;\n' +
      '  if (id === "react-native-get-random-values") return rnv.misc.reactNativeGetRandomValues;\n' +
      '  if (id === "@supabase/supabase-js") return rnv.misc.supabase;\n' +
      '  if (id === "aws-amplify") return rnv.misc.amplify;\n' +
      '  if (id === "@aws-amplify/core") return rnv.misc.ampCore;\n' +
      '  if (id === "@aws-amplify/auth") return rnv.misc.ampAuth;\n' +
      '  if (id === "@aws-amplify/storage") return rnv.misc.ampStorage;\n' +
      '  if (id === "@tensorflow/tfjs") return rnv.misc.tfjs;\n' +
      '  if (id === "@tensorflow/tfjs-react-native") return rnv.misc.tfjsReactNative;\n' +
      '  if (id === "@tensorflow-models/mobilenet") return rnv.misc.mobilenet;\n' +
      '  if (id === "uuid") return rnv.uuid;\n' +
      // @expo/vector-icons/<Font> sub-paths route through the shared
      // shim; the bare-module form (no sub-path) returns the index
      // with every font pre-built.
      '  if (id === "@expo/vector-icons") return rnv.expoVectorIcons;\n' +
      '  if (id.indexOf("@expo/vector-icons/") === 0) {\n' +
      '    var f = id.slice("@expo/vector-icons/".length);\n' +
      '    return rnv.expoVectorIcons[f] || rnv.expoVectorIcons.forFont(f);\n' +
      '  }\n' +
      '  if (id === "expo-application") return rnv.expoApplication;\n' +
      '  if (id === "expo-crypto") return rnv.expoCrypto;\n' +
      '  if (id === "expo-device") return rnv.expoDevice;\n' +
      '  if (id === "expo-watermark") return rnv.expoWatermark;\n' +
      '  if (id === "expo-file-system/legacy") return rnv.expoFileSystemLegacy;\n' +
      '  if (id === "react-native-mmkv") return rnv.reactNativeMmkv;\n' +
      // react-native-css / nativewind: the Tailwind→RN-style shim sits
      // in vendor; subpath imports (.../style-collection etc.) all
      // route through the same module since our shim exposes only the
      // top-level API surface (useCssElement, styled, vars, ...).
      '  if (id === "react-native-css" || id.indexOf("react-native-css/") === 0) return rnv.reactNativeCss;\n' +
      '  if (id === "nativewind" || id.indexOf("nativewind/") === 0) return rnv.reactNativeCss;\n' +
      '  if (id === "@react-native-community/netinfo") return rnv.netinfo;\n' +
      '  if (id === "./runtime" || id === "./runtime/index") return rnv.runtime;\n' +
      '  if (id === "./fabric" || id === "./runtime/fabric") return rnv.runtime;\n' +
      '  throw new Error("unknown vendor require: " + id);\n' +
      '};\n',
  },
  plugins: [
    svgPlaceholderPlugin,
    expoRouterRoutesPlugin,
    refreshTransformPlugin,
    // Path-alias resolution + stub fallback both run last:
    //   * tsPathAliasPlugin only fires when EXPO_ROUTER_APP_ROOT is set
    //     AND the example actually has the matched src/ layout, so it
    //     no-ops for the playground entries.
    //   * stubUnresolvedPlugin catches any remaining bare specifier the
    //     real resolvers couldn't find.
    tsPathAliasPlugin,
    stubUnresolvedPlugin,
  ],
};

// Pre-compile a bundle to Hermes bytecode. Hermes can execute .hbc
// directly (it auto-detects the magic header), skipping the
// parse/AST/codegen pass. For the 2.5 MB vendor that means cold-start
// JS init lands tens of milliseconds faster. We tolerate a missing
// hermesc — the C++ side falls back to evaluating the JS bundle.
//
// `bundlePath` is the input .js; output lands at `<bundlePath>.hbc`.
// `label` is the user-facing tag in the success log line.
function compileBytecode(bundlePath, label) {
  // Order matters — `existsSync` doesn't check that the binary is
  // exec-able on the current host. Bytecode is portable across
  // architectures, so the macOS hermesc producing output for the
  // Linux VM is fine; we just need to pick the one that actually
  // RUNS where the bundler runs. The VM-built `vnext/build/bin/hermesc`
  // is an ARM64 Linux ELF, which `spawn` on macOS hits with an
  // `Exec format error` (status null in the log).
  const isMacOS = process.platform === 'darwin';
  // Order matters AND versions must match. The runtime is whatever
  // Hermes commit FetchHermes.cmake pins (currently hermes-v0.16.0,
  // the legacy VM). The bundler must produce bytecode that runtime
  // can parse — and the bytecode format changed in Hermes V1.
  //
  // Local + CI Linux: prefer hermesc built FROM the same source tree
  // we linked against. Two locations:
  //   - vnext/build/bin/hermesc        (standalone vnext build)
  //   - apps/playground/linux/build/bin/hermesc (playground build,
  //     CI smoke job uses this one — the vnext build doesn't run
  //     there)
  // Only fall back to node_modules/hermes-compiler if neither built
  // hermesc exists; it's Hermes V1 (CalVer 250829098.0.10) and
  // produces bytecode the 0.16 runtime can't read. Skipping hermesc
  // entirely is better than that mismatch — the C++ side then
  // interprets the .js source which is slower but works.
  const builtHermescPlayground = resolve(here, 'linux/build/bin/hermesc');
  const hermescCandidates = isMacOS
    ? [
        resolve(here, '../../vnext/build/bin/hermesc'),
        builtHermescPlayground,
        resolve(here, '../../node_modules/hermes-compiler/hermesc/osx-bin/hermesc'),
        resolve(here, '../../node_modules/react-native/sdks/hermesc/osx-bin/hermesc'),
      ]
    : [
        resolve(here, '../../vnext/build/bin/hermesc'),
        builtHermescPlayground,
        resolve(here, '../../node_modules/hermes-compiler/hermesc/linux64-bin/hermesc'),
        resolve(here, '../../node_modules/react-native/sdks/hermesc/linux64-bin/hermesc'),
      ];
  const hermesc = hermescCandidates.find(existsSync);
  const hbc = bundlePath + '.hbc';
  // Any failure path falls back to "let the C++ side load the fresh
  // .js bundle directly" — but main.cpp prefers .hbc when one exists,
  // so we have to actively wipe a stale .hbc produced by an earlier
  // run before we hand control back. Otherwise a hermesc failure on
  // a paper-demo entry would leave the playground happily loading the
  // PREVIOUS entry's bytecode.
  const wipeStale = () => {
    if (!existsSync(hbc)) return;
    try {
      unlinkSync(hbc);
      console.log(`✓ removed stale ${hbc} (falling back to JS source)`);
    } catch (e) {
      console.log(`[hermesc] could not remove stale ${hbc}: ${e.message}`);
    }
  };
  if (!hermesc) {
    console.log(`[hermesc] not found — ${label} stays as JS source`);
    wipeStale();
    return;
  }
  const t0 = performance.now();
  const r = spawnSync(hermesc, ['-emit-binary', '-O', '-out', hbc, bundlePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    console.log(
      `[hermesc] ${label} failed (status ${r.status}): ${r.stderr?.toString().slice(0, 200)}`,
    );
    wipeStale();
    return;
  }
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`✓ hermesc → ${hbc} (${ms}ms)`);
}

// esbuild's __copyProps helper (added at the top of every bundle for
// CJS/ESM interop) uses `for (let key of …) { __defProp(to, key, {
// get: () => from[key] }) }`. Hermes mis-compiles per-iteration
// `let`/`const` bindings in for-of — all closures capture the LAST
// `key`, so every named import returns the value of the module's last
// property. Confirmed with a 3-key repro that returned CC,CC,CC.
// Workaround: rewrite the for-of loop to a `.forEach()`, which gives
// each callback its own scope and isolates the closure.
function patchHermesForOfBug(filePath) {
  let src = readFileSync(filePath, 'utf8');
  // Regex-based replace tolerates esbuild's varying indentation
  // between the once() and watchMode() output paths, and between
  // vendor and app bundles which sometimes differ by one indent step.
  const buggy =
    /for \(let key of __getOwnPropNames\(from\)\)\s+if \(!__hasOwnProp\.call\(to, key\) && key !== except\)\s+__defProp\(to, key, \{ get: \(\) => from\[key\], enumerable: !\(desc = __getOwnPropDesc\(from, key\)\) \|\| desc\.enumerable \}\);/;
  const fixed =
    '__getOwnPropNames(from).forEach(function (key) { ' +
    'if (!__hasOwnProp.call(to, key) && key !== except) { ' +
    'var d = __getOwnPropDesc(from, key); ' +
    '__defProp(to, key, { get: function () { return from[key]; }, enumerable: !d || d.enumerable }); ' +
    '} });';
  const before = src;
  src = src.replace(buggy, fixed);
  if (src === before) return false;
  writeFileSync(filePath, src);
  return true;
}

async function once() {
  await build(vendorOpts);
  const vp = patchHermesForOfBug(vendorOut);
  console.log(`✓ vendor → ${vendorOut}${vp ? ' (Hermes for-of patched)' : ''}`);
  compileBytecode(vendorOut, 'vendor');
  await build(appOpts);
  const ap = patchHermesForOfBug(appOut);
  console.log(`✓ app    → ${appOut}${ap ? ' (Hermes for-of patched)' : ''}`);
  // The playground's main.cpp prefers `<appBundle>.hbc` over the JS
  // source when both exist. Without this second compile step, an
  // `RN_ENTRY=…` re-bundle would write a new index.linux.bundle but
  // the playground would keep loading whatever stale .hbc was lying
  // next to it — so dev iterations on the entry file silently
  // wouldn't show up.
  compileBytecode(appOut, 'app');
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
  return new Promise(resolveP => {
    const sock = hmrSocketPath();
    const c = createConnection(sock);
    let done = false;
    const finish = msg => {
      if (done) return;
      done = true;
      try {
        c.destroy();
      } catch {}
      resolveP(msg);
    };
    c.once('error', err => finish(`socket error: ${err.code || err.message}`));
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
  patchHermesForOfBug(vendorOut);
  console.log(`✓ vendor → ${vendorOut} (one-shot)`);
  compileBytecode(vendorOut, 'vendor');
  // Wrap with timing + HMR-push hooks so we can both report rebuild
  // duration and shove the new bundle into the live playground over
  // a Unix socket (the C++ side listens; see startHmrSocket).
  const hmrPlugin = {
    name: 'hmr-push',
    setup(b) {
      let start = 0;
      b.onStart(() => {
        start = performance.now();
      });
      b.onEnd(async result => {
        if (result.errors && result.errors.length) {
          console.log(`[watch] rebuild failed in ${(performance.now() - start).toFixed(1)}ms`);
          return;
        }
        // Workaround for the Hermes for-of let bug — see
        // patchHermesForOfBug. Must run BEFORE pushing the bundle over
        // the HMR socket or the live runtime will re-evaluate broken JS.
        patchHermesForOfBug(appOut);
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
  // Delete any stale `<appOut>.hbc` from an earlier `once()` run.
  // The playground's main.cpp prefers .hbc when it exists, so leaving
  // a stale bytecode file means a fresh cold-boot during the watch
  // session would load the old code instead of the JS we're now
  // rebuilding on every save.
  const staleHbc = appOut + '.hbc';
  if (existsSync(staleHbc)) {
    try {
      unlinkSync(staleHbc);
      console.log(`✓ removed stale ${staleHbc}`);
    } catch (e) {
      console.log(`[watch] could not remove stale ${staleHbc}: ${e.message}`);
    }
  }
  console.log(`👀 watching ${resolve(here, 'index.tsx')} → ${appOut}`);
  console.log(`📡 HMR push: ${hmrSocketPath()}`);
}

if (watch) {
  await watchMode();
} else {
  await once();
}
