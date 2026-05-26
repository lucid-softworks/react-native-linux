# Real-app harness: react-native-paper

A first-pass test of "drop a real RN UI library into the playground and run it" using `react-native-paper@^5`. The goal isn't to make Paper fully work — it's to enumerate the production-readiness gaps that only show up when real third-party code hits the runtime.

## Running

```sh
cd apps/playground
RN_ENTRY=paper-demo.tsx node bundle.mjs
limactl shell --workdir /workspaces/react-native-linux rn-linux \
  /workspaces/react-native-linux/scripts/vm/run-playground.sh
```

## Status

| Stage                                                                             | Status                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Module resolution                                                                 | ✅                                                            |
| Asset loading (`.png`, `.ttf`)                                                    | ✅                                                            |
| Flow-syntax `Native*` spec files                                                  | ✅                                                            |
| Hermes class lowering                                                             | ✅                                                            |
| `NativeModules.PlatformConstants` / `I18nManager` / `PixelRatio` / `processColor` | ✅                                                            |
| First mount commit                                                                | ❌ — `RawPropsParser::preparse` crashes on a `TextInput` prop |

## Gaps fixed in this pass

Each fix below was discovered by trying to bundle / load / render `paper-demo.tsx`:

1. **`mainFields` unset** — esbuild's `platform: 'neutral'` ignored every npm package's `main` / `module` / `react-native` field, so any third-party module failed to resolve. Fix in `apps/playground/bundle.mjs`: explicit `mainFields: ['react-native', 'browser', 'module', 'main']` matching Metro's chain. Without this, **no third-party React Native library can load**.
2. **No asset loader** — esbuild errored on the first `.png` import (`react-native-paper/.../back-chevron.png`). Fix: register `'.png' / '.jpg' / '.ttf' / …` as `dataurl` so the bundle is self-contained. Switch to `'file'` + an output asset manifest for larger binary blobs.
3. **Flow / TS syntax in `.js` codegen files** — RN's `Native*` spec files (e.g. `react-native-vector-icons/lib/NativeRNVectorIcons.js`) are Flow-flavoured (`// @flow`, `(expr: ?Type)` casts) but ship with a `.js` extension. esbuild's JSX loader can't parse them. Fix: extend the swc plugin to run `flow-remove-types` on any `Native*.js` file plus any file with a `@flow` pragma, then pipe through swc.
4. **Hermes class compile** — Hermes 0.12 rejects `var X = class extends MemberExpression {...}` (the wrapping shape esbuild emits when CJS-converting `class X extends React.Component {}`). esbuild's own class-lowering is incomplete (`Transforming class syntax to the configured target environment ("es2020") is not supported yet`). Fix: detect any node_modules file with `class ... extends Foo.Bar` and run it through swc with `target: 'es5'` — swc lowers classes to function constructors Hermes accepts. Other modern syntax stays intact for our own code (target `es2020`).
5. **`NativeModules` missing from shim** — Real RN libraries access modules via `NativeModules.X` rather than `TurboModuleRegistry.get('X')`. Fix: Proxy-backed `NativeModules` that defers to `TurboModuleRegistry`, falls back to a stub-of-noops for unknown names, and special-cases `PlatformConstants` so destructuring it doesn't crash.
6. **`I18nManager`, `PixelRatio`, `processColor` missing** — `react-native-paper`'s `Text` reads `I18nManager.getConstants().isRTL` to mirror layouts; layout helpers read `PixelRatio`; theme code passes string colors through `processColor`. Added stubs to `apps/playground/runtime/react-native.js`.

## Remaining blocker

**`RawPropsParser::preparse` crash on TextInput.** Hermes finishes evaluating, surface starts, React commits — and the first `<TextInput>` mount aborts via `std::terminate` in `dynamicFromValue`. Stack:

```
facebook::jsi::dynamicFromValue
facebook::react::RawPropsParser::preparse
facebook::react::ConcreteComponentDescriptor<rnlinux::TextInputShadowNode>::cloneProps
facebook::react::UIManager::createNode
```

Paper's `TextInput` passes a richer prop shape than our `BaseTextInputProps` parser handles — most likely a function (an `inputRef` callback) or an `Animated.Value` (focus animation) in a place Fabric expects a primitive. The right fix is to make `dynamicFromValue` / our `TextInputProps` defensive about non-serialisable values: log + skip, don't terminate.

This is a real production-readiness gap. It's separate from this commit — opening as the next thing to investigate.

## What this run actually proved

- Six concrete bundler / shim gaps that would have blocked any non-trivial third-party RN library, all fixed.
- A real prop-parsing crash that wouldn't have surfaced without trying a real component library — exactly why the harness exists.
- The bundle pipeline now handles `mainFields`, assets, Flow, Hermes class lowering, and most of the legacy `react-native` shim surface; further libraries will exercise it without these blocking.
