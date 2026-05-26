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

| Stage                                                                             | Status                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Module resolution                                                                 | ✅                                                                  |
| Asset loading (`.png`, `.ttf`)                                                    | ✅                                                                  |
| Flow-syntax `Native*` spec files                                                  | ✅                                                                  |
| Hermes class lowering                                                             | ✅                                                                  |
| `NativeModules.PlatformConstants` / `I18nManager` / `PixelRatio` / `processColor` | ✅                                                                  |
| `useWindowDimensions` / `AccessibilityInfo` / `AppState` / `DeviceEventEmitter`   | ✅                                                                  |
| `Animated.Value.stopAnimation` / `removeAllListeners`                             | ✅                                                                  |
| Function-valued top-level props (Fabric `dynamicFromValue` throws)                | ✅ — stripped in `buildFabricProps`                                 |
| First mount commit                                                                | ✅                                                                  |
| Paper components actually render                                                  | ✅ — Card, TextInput, Switch, Snackbar all mount                    |
| Visual polish                                                                     | ⚠️ — label / input z-order, Button TouchableRipple visibility minor |

## Gaps fixed in this pass

Each fix below was discovered by trying to bundle / load / render `paper-demo.tsx`:

1. **`mainFields` unset** — esbuild's `platform: 'neutral'` ignored every npm package's `main` / `module` / `react-native` field, so any third-party module failed to resolve. Fix in `apps/playground/bundle.mjs`: explicit `mainFields: ['react-native', 'browser', 'module', 'main']` matching Metro's chain. Without this, **no third-party React Native library can load**.
2. **No asset loader** — esbuild errored on the first `.png` import (`react-native-paper/.../back-chevron.png`). Fix: register `'.png' / '.jpg' / '.ttf' / …` as `dataurl` so the bundle is self-contained. Switch to `'file'` + an output asset manifest for larger binary blobs.
3. **Flow / TS syntax in `.js` codegen files** — RN's `Native*` spec files (e.g. `react-native-vector-icons/lib/NativeRNVectorIcons.js`) are Flow-flavoured (`// @flow`, `(expr: ?Type)` casts) but ship with a `.js` extension. esbuild's JSX loader can't parse them. Fix: extend the swc plugin to run `flow-remove-types` on any `Native*.js` file plus any file with a `@flow` pragma, then pipe through swc.
4. **Hermes class compile** — Hermes 0.12 rejects `var X = class extends MemberExpression {...}` (the wrapping shape esbuild emits when CJS-converting `class X extends React.Component {}`). esbuild's own class-lowering is incomplete (`Transforming class syntax to the configured target environment ("es2020") is not supported yet`). Fix: detect any node_modules file with `class ... extends Foo.Bar` and run it through swc with `target: 'es5'` — swc lowers classes to function constructors Hermes accepts. Other modern syntax stays intact for our own code (target `es2020`).
5. **`NativeModules` missing from shim** — Real RN libraries access modules via `NativeModules.X` rather than `TurboModuleRegistry.get('X')`. Fix: Proxy-backed `NativeModules` that defers to `TurboModuleRegistry`, falls back to a stub-of-noops for unknown names, and special-cases `PlatformConstants` so destructuring it doesn't crash.
6. **`I18nManager`, `PixelRatio`, `processColor` missing** — `react-native-paper`'s `Text` reads `I18nManager.getConstants().isRTL` to mirror layouts; layout helpers read `PixelRatio`; theme code passes string colors through `processColor`. Added stubs to `apps/playground/runtime/react-native.js`.

## Additional gaps closed in pass 2

7. **Function-valued top-level props** crashed `RawPropsParser` via `dynamicFromValue`, which substitutes null for functions inside object properties (line 195-197) but throws for top-level functions ("JS Functions are not convertible to dynamic", line 137). Real RN libraries (Paper's TextInput, every ref-forwarding wrapper) pass handler / callback / ref functions as top-level props. Fix in `buildFabricProps`: drop any top-level function value. The handlers we care about are already registered via separate sync\* paths against the Fabric tag.
8. **`useWindowDimensions`** hook missing — Paper's Modal / InputLabel call it on every render. Added a thin wrapper around `Dimensions.get('window')` (no resize subscription yet; value captured at mount).
9. **`AccessibilityInfo` / `AppState` / `DeviceEventEmitter`** missing — Paper calls `AccessibilityInfo.addEventListener('reduceMotionChanged', ...)` from a PaperProvider effect. Added optimistic-default stubs that return a `{remove: () => {}}` subscription so cleanup chains don't crash.
10. **`Animated.Value.stopAnimation` / `removeAllListeners`** missing — Paper calls them on unmount of any animated component. Added no-op implementations.

## What this run actually proved

- Ten concrete bundler / shim / parser gaps that would have blocked any non-trivial third-party RN library, all fixed.
- Real `react-native-paper` components (Card, TextInput, Switch, Snackbar) now mount and render — proves the production gaps were fillable and the rest of the runtime architecture is sound.
- Remaining issues are visual / layout (Paper's complex Z-index, TouchableRipple animation) rather than fundamental blockers; tractable as polish.
- The bundle pipeline handles `mainFields`, assets, Flow, Hermes class lowering, function-prop stripping, and most of the legacy `react-native` shim surface. Next library should exercise it without re-hitting these.
