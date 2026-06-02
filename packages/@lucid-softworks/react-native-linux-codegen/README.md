# @lucid-softworks/react-native-linux-codegen

Linux-platform code generator covering both **TurboModules** and
**Fabric components**. Takes `@react-native/codegen`'s parsed schema
and emits self-contained C++ headers:

- TurboModule specs → `<SpecName>Spec.h` with a JSI-HostObject-
  backed abstract class.
- Fabric component specs → `<ComponentName>Spec.h` with `Props`,
  `EventEmitter`, `ShadowNode`, and `ComponentDescriptor` types.

This is the Linux equivalent of upstream codegen's
`GenerateModuleH.js` / `GenerateComponentDescriptorH.js`, plus
`@react-native-windows/codegen`'s Windows-specific structuring.

## Usage

```ts
import {generateFromFile, writeFromFiles} from '@lucid-softworks/react-native-linux-codegen';

// One-off: get the headers for a single spec back as in-memory strings.
const files = generateFromFile('/abs/path/NativeFoo.ts');
//=> [{filename: 'NativeFooSpec.h', contents: '…', moduleName: 'Foo'}]

// Batch: walk a list and write to disk.
const written = writeFromFiles(['/abs/path/NativeFoo.ts'], '/abs/out/specs');
//=> ['/abs/out/specs/NativeFooSpec.h']
```

In practice you almost never call this directly. The two wired
entry points are:

- `scripts/codegen/run.js` — in-tree generator, drives the rn-linux
  core specs (e.g. `NativePlatformConstantsLinux`,
  `NativeCodegenSmoke`).
- `react-native autolink-linux` — third-party deps. Picks up the
  standard RN `codegenConfig` key in each linked dep's
  `package.json`, locates `Native*.ts` under `jsSrcsDir`, and emits
  headers under `linux/build/codegen/<dep>/specs/` with the
  matching `target_include_directories` line in `autolinked.cmake`.

## Generated shape

For a spec:

```ts
export interface Spec extends TurboModule {
  add(a: number, b: number): number;
  fetchUser(id: string): Promise<{name: string; age: number}>;
  subscribe(cb: (event: string, count: number) => void): void;
}
```

…the generator emits a `Native<SpecName>Spec.h` that contains:

- Generated structs for every `ObjectTypeAnnotation` reached from a
  param or return (recursive, post-order naming
  `<Method>Result_<Field>`), each with `toDynamic` and `static
fromDynamic` helpers.
- The spec class `Native<SpecName>Spec` extending
  `rnlinux::TurboModule` with one pure virtual per method,
  signature lowered to typed C++.
- `template <typename Impl> static int install()` — a one-liner
  registration helper. Drop this in a `static auto` slot in your
  impl TU and the module is wired into `TurboModuleRegistry` at
  load time.
- Inline `jsi::HostObject::get` / `getPropertyNames` overrides that
  dispatch every spec method to the virtuals via
  `createFromHostFunction`, with Promise resolve/reject and callback
  invocation routed through `rnlinux::getRuntimeExecutor()` so
  resolve/reject and callback calls are safe off-thread.

## Implementer surface

```cpp
#include "specs/NativeFooSpec.h"

namespace rnlinux {
namespace {

class FooImpl final : public codegen::NativeFooSpec {
 public:
  double add(double a, double b) override { return a + b; }

  void fetchUser(std::string id,
                 std::function<void(codegen::FetchUserResult)> resolve,
                 std::function<void(folly::dynamic)> reject) override {
    fetchAsync(id, [resolve = std::move(resolve)](User u) {
      resolve({.name = u.name, .age = u.age});
    });
  }

  void subscribe(std::function<void(std::string, double)> cb) override {
    onEvent_ = std::move(cb);
  }

  std::function<void(std::string, double)> onEvent_;
};

[[maybe_unused]] static const int kRegister =
    codegen::NativeFooSpec::install<FooImpl>();

}  // namespace
}  // namespace rnlinux
```

That's the entire integration. The implementer overrides one
virtual per spec method and calls `install<Impl>()`; the generator
owns every line of JSI plumbing.

## Type coverage

| Spec type                     | C++                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `string`                      | `std::string`                                                                                                       |
| `number` / `double` / `float` | `double`                                                                                                            |
| `Int32`                       | `int32_t`                                                                                                           |
| `boolean`                     | `bool`                                                                                                              |
| `void` (return)               | `void`                                                                                                              |
| Object                        | generated `struct` with `toDynamic` + `static fromDynamic` (recursive)                                              |
| Array / generic object        | `folly::dynamic`                                                                                                    |
| `Nullable<T>`                 | inner C++ (MVP)                                                                                                     |
| `Enum<string \| number>`      | underlying primitive                                                                                                |
| `Promise<T>`                  | trailing `std::function<void(T)> resolve, std::function<void(folly::dynamic)> reject`, posted via `RuntimeExecutor` |
| `(...args) => void` callback  | `std::function<void(args...)>`, posted via `RuntimeExecutor`                                                        |

## Fabric components

`<FooView>NativeComponent.ts` specs lower to a `<ComponentName>Spec.h`
that contains:

- `inline constexpr const char <Name>ComponentName[]` — the Fabric
  component-name template parameter.
- `<Name>Props` extending `react::ViewProps`, with one typed field
  per spec prop parsed via `convertRawProp` (defaults pulled from
  the spec annotation).
- `<Name>EventEmitter` extending `react::ViewEventEmitter` with one
  `void onFoo(args...)` method per spec event, dispatching a typed
  jsi payload through Fabric's event pipe.
- `<Name>ShadowNode` (ConcreteViewShadowNode instantiation) +
  `<Name>ComponentDescriptor` alias.
- `inline void register<Name>(ComponentDescriptorProviderRegistry&)`
  — one-liner registration helper.

The implementer still writes a `LinuxComponentView` subclass that
mounts/updates/unmounts the GTK widget (codegen can't know how
your component renders). See `vnext/src/components/Switch.cpp`
for a worked hand-written example of the same pattern.

## Type coverage — components

| Spec type                                      | C++                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `boolean` prop                                 | `bool`                                                                                                        |
| `string` prop                                  | `std::string`                                                                                                 |
| `Int32` prop                                   | `int32_t`                                                                                                     |
| `Double` / `Float` / `Number` prop             | `double` / `float`                                                                                            |
| `ColorValue` (ColorPrimitive)                  | `facebook::react::SharedColor`                                                                                |
| `PointValue` (PointPrimitive)                  | `facebook::react::Point`                                                                                      |
| `EdgeInsetsValue` (EdgeInsetsPrimitive)        | `facebook::react::EdgeInsets`                                                                                 |
| Dimension (DimensionPrimitive)                 | `facebook::react::Float`                                                                                      |
| `WithDefault<"a"\|"b"\|..., ...>` (StringEnum) | `enum class <Comp><Prop>` + ADL `fromRawValue` + `toString`                                                   |
| Direct event with primitive payload            | typed `<Name><Event>` struct + `onFoo(...)` emitter method                                                    |
| Bubble events                                  | (treated as direct today)                                                                                     |
| `ViewProps` extension                          | ✓                                                                                                             |
| `ImageSource` (ImageSourcePrimitive)           | `facebook::react::ImageSource`                                                                                |
| Object / Array props                           | ✗ throws                                                                                                      |
| `WithDefault<0\|1\|..., 0>` (Int32Enum)        | `enum class <Comp><Prop> : int32_t` + int-keyed `fromRawValue`                                                |
| Commands (`codegenNativeCommands<...>`)        | templated `<Name>HandleCommand(view, name, args)` dispatcher; runtime via `LinuxComponentView::handleCommand` |

## Known follow-ups

- Non-void callback returns. `(...) => T` callbacks throw at
  generation time today. Real specs nearly always use
  `(...) => void` (success/error / on-event patterns); when one
  needs a sync return value, the generator would have to capture
  `rt_` by-pointer and document the call-from-JS-thread constraint.
- `schema.aliasMap` name reuse. Inline anonymous objects get
  path-derived names today (`<Method>Result_<Field>`). When the
  spec defines a named type alias, the generator could use the
  alias name directly and dedupe across methods.
- Object / Array props on Fabric components. Less common than
  on TurboModules; would mirror the TM-side StructCollector
  pattern.

## Compile-time guard

`vnext/src/modules/CodegenSmoke.cpp` is a stub implementation that
exercises every non-trivial generator path (primitive, void,
object-in/out, `Promise<void>`, `Promise<typed object>`, multi-arg
callback). Any regression in the emitted C++ breaks the vnext build
immediately instead of waiting for a downstream consumer to find
it.
