# Writing native modules

react-native-linux exposes Linux-side functionality through **TurboModules**
(synchronous codegen-validated bindings) and **Fabric host components**
(rendered native views). The legacy bridge is not supported.

## TurboModule: bottom-up walkthrough

### 1. Author the spec (JS)

Specs live alongside the JS surface, in `Libraries/Specs/`. Example
(`NativeFileSystem.ts`):

```ts
import {TurboModuleRegistry} from 'react-native';
import type {TurboModule} from 'react-native';

export interface Spec extends TurboModule {
  readFile(path: string): Promise<string>;
  getCacheDir(): string;
}

export default TurboModuleRegistry.getEnforcing<Spec>('FileSystem');
```

### 2. Run codegen

```sh
pnpm exec react-native-codegen --platform linux --path .
```

This produces `NativeFileSystemSpec.h` under
`packages/<your-package>/codegen/`. The header declares an abstract C++ class
with one pure virtual per JS method.

### 3. Implement in C++ (vnext or your own package)

```cpp
#include "NativeFileSystemSpec.h"

namespace rnlinux {

class FileSystem : public NativeFileSystemSpec<FileSystem> {
 public:
  std::string getCacheDir(jsi::Runtime&) {
    return std::string{g_get_user_cache_dir()};
  }

  jsi::Value readFile(jsi::Runtime& rt, std::string path) {
    // Use folly's asyncio or a worker pool. Resolve/reject the returned
    // Promise from a background thread via jsi::AsyncCallback.
    ...
  }
};

}  // namespace rnlinux
```

### 4. Register with the TurboModuleManager

In your CMake target's init function:

```cpp
TurboModuleManager::registerModule(
    "FileSystem",
    [](std::shared_ptr<CallInvoker> ji) {
      return std::make_shared<FileSystem>(std::move(ji));
    });
```

For modules shipped in core, registration happens inside `RNLinuxHost::start`.
For third-party modules, registration is wired up by the
[autolink-linux](#autolinking) flow.

## Fabric host component

Skeleton:

1. Author the JS codegen spec (`<Name>NativeComponent.js`).
2. Run codegen to produce C++ `<Name>Props.h`, `<Name>State.h`,
   `<Name>ComponentDescriptor.h`.
3. Subclass `rnlinux::LinuxComponentView` in `vnext/src/views/`.
4. Implement `updateProps`, optional `updateState`, optional event emission.
5. Register a factory in `LinuxComponentViewRegistry`.
6. Register the descriptor in `LinuxComponentDescriptorRegistry`.

See `ViewComponentView.cpp` and `ParagraphComponentView.cpp` as canonical
examples.

## Autolinking

Third-party modules opt in via their `react-native.config.js`:

```js
module.exports = {
  dependency: {
    platforms: {
      linux: {
        sourceDir: 'linux',          // dir containing CMakeLists.txt
        cmakeTarget: 'my_module',    // CMake target name to link
      },
    },
  },
};
```

`pnpm react-native autolink-linux` walks `node_modules` and emits
`linux/build/autolinked.cmake` listing every `add_subdirectory(...)` and
`target_link_libraries(... PRIVATE ...)` your app needs. The template's
`linux/CMakeLists.txt` includes that file automatically.

## Threading rules

- TurboModule methods are called on the **JS thread**. Don't block — offload
  to a folly executor or a `std::thread` and resolve the promise from there.
- Fabric component-view callbacks (`updateProps`, `mountChild`, ...) are
  called on the **UI thread** (GTK main loop). It is safe to call GTK APIs
  directly there.
- To dispatch UI → JS, capture a `RuntimeExecutor` at construction time and
  call it with a lambda that takes `jsi::Runtime&`.
