# @lucid-softworks/react-native-linux-codegen

Linux-platform TurboModule code generator. Takes
`@react-native/codegen`'s parsed schema and emits self-contained C++
headers backed by `facebook::jsi::HostObject`.

This is the Linux equivalent of `GenerateModuleH.js` /
`GenerateModuleObjCpp` from upstream codegen, plus
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

## Known follow-ups

- Non-void callback returns. `(...) => T` callbacks throw at
  generation time today. Adding this mirrors Promise resolve:
  marshal the JS return value back through `valueFromDynamic` /
  the per-type `fromJsi`.
- Object args in callbacks. Today `(...args)` containing an
  ObjectType param throws because the StructCollector only walks
  top-level method types. Extending it to recurse into callback
  arg types is straightforward.
- `schema.aliasMap` name reuse. Inline anonymous objects get path-
  derived names today (`<Method>Result_<Field>`). When the spec
  defines a named type alias, the generator could use the alias
  name directly and dedupe across methods.
- Fabric component generators. TurboModules only for now; Props.h /
  ComponentDescriptor.h / EventEmitters.h would need a separate
  pipeline.

## Compile-time guard

`vnext/src/modules/CodegenSmoke.cpp` is a stub implementation that
exercises every non-trivial generator path (primitive, void,
object-in/out, `Promise<void>`, `Promise<typed object>`, multi-arg
callback). Any regression in the emitted C++ breaks the vnext build
immediately instead of waiting for a downstream consumer to find
it.
