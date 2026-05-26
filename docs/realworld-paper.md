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

| Stage                                                                             | Status                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Module resolution                                                                 | ✅                                                                 |
| Asset loading (`.png`, `.ttf`)                                                    | ✅                                                                 |
| Flow-syntax `Native*` spec files                                                  | ✅                                                                 |
| Hermes class lowering                                                             | ✅                                                                 |
| `NativeModules.PlatformConstants` / `I18nManager` / `PixelRatio` / `processColor` | ✅                                                                 |
| `useWindowDimensions` / `AccessibilityInfo` / `AppState` / `DeviceEventEmitter`   | ✅                                                                 |
| `Animated.Value.stopAnimation` / `removeAllListeners`                             | ✅                                                                 |
| Function-valued top-level props (Fabric `dynamicFromValue` throws)                | ✅ — stripped in `buildFabricProps`                                |
| First mount commit                                                                | ✅                                                                 |
| Paper components actually render                                                  | ✅ — Card, TextInput, Switch, Snackbar all mount                   |
| Buttons visually render                                                           | ✅ — contained / outlined / text variants all show their labels    |
| `transform` style (scale / rotate / translate / matrix / origin)                  | ✅ — composed via Transform::FromTransformOperation + GskTransform |
| `onLayout` event                                                                  | ✅ — dispatched from LinuxComponentView::updateLayoutMetrics       |
| TextInput.Outlined floating label                                                 | ✅ — renders inline at full input width                            |

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

## Pass 3 — function-children Pressable

11. **Pressable's function-children render-prop form was unhandled** — RN's Pressable accepts `children` as either `ReactNode` or `(state) => ReactNode` where state is `{pressed, hovered, focused}`. Paper's `TouchableRipple` (and every theme-aware button library, every react-navigation pressable link) uses the function form so the rendered content can change per-state. Our shim forwarded the function straight through to the host, React saw "Functions are not valid as a React child", and silently bailed the entire subtree under any function-children Pressable. The most visible casualty was every `<Button>` rendering as an empty 0×0 rectangle. Fix in `components.js`: detect a function children at the Pressable shim level and invoke it with a static `{pressed:false, hovered:false, focused:false}` state. Visual feedback per-state needs the GTK gesture controller to plumb `pressed`/`hovered` back into React, which is a smaller follow-up than letting a quarter of the RN ecosystem render blank.

## Pass 5 — onLayout

13. **`onLayout` never fired** — Paper's TextInput captures the input container's width through `onLayout={e => setInputContainerLayout({width: e.nativeEvent.layout.width})}`, defaulting to `{width: 65}` until the callback arrives. With no onLayout dispatch, the floating label's container stayed sized for a 65-px input — `labelWidth = (65 + INPUT_PADDING_HORIZONTAL/2) / labelScale ≈ 97 px` — and "Your name" wrapped to two lines stacked under the input. Fix: special-case `onLayout` like the other handler props (`onClick`, `onChangeText`, …): JS calls `rnLinux.fabricOnLayout(tag, fn)` per commit, C++ keeps a tag → jsi::Function map, and `LinuxComponentView::updateLayoutMetrics` calls `dispatchFabricLayout(tag, x, y, w, h)` whenever metrics change. Dedupe via a `last == next` check per tag so handler-driven setState doesn't loop. Bypasses RN's normal event-emitter machinery (we don't have it wired); the dispatch is synchronous on the GTK thread, same as every other fabricOn\* path.

## Pass 4 — CSS transform support

12. **`transform` style was a no-op** — RN's `RawProps→Transform` parser pushes operations into `transform.operations` but only fills `transform.matrix` for the literal `[{matrix: [...]}]` form. Every other shape (`[{scale: 2}]`, `[{rotate: '30deg'}]`, `[{translateY: 8}]`) left the matrix as identity, so reading `vp.transform.matrix` always saw I₄. Paper's TextInput.Outlined label, every Animated transform, every `react-native-reanimated` style — all silently identity. Fix in `ViewComponentView`: walk `vp.transform.operations` through `Transform::FromTransformOperation(op, frameSize)` and multiply, mirroring what RN's iOS/Android sides do before handing to the platform. Wrap the result in `translate(origin) · M · translate(-origin)` so scale/rotate happen around the configured origin (defaults to view center, matching CSS `transform-origin: 50% 50%`). Compose with `gtk_fixed_set_child_transform` on the parent's GtkFixed, prefixed by `translate(layoutX, layoutY)` so Yoga's positioning still takes effect (GtkFixed reuses one transform slot for both move and child-transform).

## Remaining issues

- **TextInput.Outlined floating label**: transforms now apply, but Paper's label container width is computed against the unscaled Pango text measurement — when Paper sets `transform: [{scale: 0.75}]` for the floating state, the container is sized for the scaled visible width, but our measure returns the unscaled width, so the label wraps. Likely fix is a measure-time honour of an ancestor `transform.scale` (rare in practice) or a Paper-side `mode="flat"` recommendation; tracking down which.
- **Paper Button click → Snackbar**: clicking the rendered Button doesn't fire its `onPress`. Our `fabricClick` is registered on every View's gesture controller, but Paper's `TouchableRipple` routes through `accessibilityRole` + custom gesture handling that may swallow the click before our default path sees it. Snackbar / Modal also rely on `Portal` which we haven't validated end-to-end.

## What this run actually proved

- Eleven concrete bundler / shim / parser gaps that would have blocked any non-trivial third-party RN library, all fixed.
- Real `react-native-paper` components mount and render visually — Cards layout, Buttons show their labels (contained / outlined / text variants), TextInput input field works, Switch toggles.
- Remaining issues are CSS-transform support (a layout-engine feature) and per-state Pressable feedback (a gesture-controller plumbing detail) — both narrow and well-scoped, not architectural.
- The bundle pipeline handles `mainFields`, assets, Flow, Hermes class lowering, function-prop stripping, function-children Pressable, and most of the legacy `react-native` shim surface. Next library should exercise it without re-hitting these.
