# react-native-linux

React Native for Linux desktop. Renders to GTK4, runs JS on Hermes, uses the
new architecture (Fabric + TurboModules) from day one. Inspired by and
structurally modeled after
[microsoft/react-native-windows](https://github.com/microsoft/react-native-windows).

> **Status:** pre-MVP. The repo scaffolding, JS surface, and a C++ runtime
> skeleton are in place. The native runtime does not yet fully build end-to-end
> — see [TODO.md](./TODO.md) for the live roadmap.

## Goals

- Make `npx @react-native-community/cli init MyApp` work with
  `react-native-linux` added, then `yarn react-native run-linux` open a GTK4
  window that renders `<View><Text>Hello</Text></View>`.
- Keep the JS authoring experience identical to React Native on
  iOS/Android/Windows. `Platform.OS === 'linux'`; everything else is RN.
- Stay Fabric-only — no legacy bridge, no legacy view managers.

## Repo layout

```
react-native-linux/
├── packages/
│   ├── react-native-linux/          # JS-side npm package (Platform shim, components)
│   └── @react-native-linux/cli/     # CLI plugin: run-linux, bundle-linux, init
├── vnext/                           # Native C++ runtime (CMake)
│   ├── include/react-native-linux/  # Public headers
│   ├── src/                         # Implementation
│   └── cmake/                       # Helper modules (FetchHermes, FindGTK4, ...)
├── template/                        # `react-native init` template
│   ├── App.tsx
│   └── linux/                       # The Linux project files copied into apps
├── apps/                            # First-party sample / playground apps
├── docs/                            # Architecture, getting-started, etc.
└── TODO.md                          # Live roadmap
```

## Locked-in decisions

| Concern              | Choice                                  |
| -------------------- | --------------------------------------- |
| UI toolkit           | GTK4                                    |
| JS engine            | Hermes (built from source via CMake)    |
| Architecture         | Fabric + TurboModules only              |
| Layout               | Yoga (bundled with RN)                  |
| Package manager      | yarn 3                                  |
| Build system         | CMake (Ninja)                           |
| Minimum RN           | `^0.76`                                 |
| Minimum distro       | Ubuntu 22.04 LTS                        |
| License              | MIT                                     |

## Quick start (intended UX once the runtime builds)

```sh
# In an existing RN app
yarn add react-native-linux @react-native-linux/cli --dev
yarn react-native init-linux
yarn react-native run-linux
```

## Build dependencies (Ubuntu 24.04)

```sh
sudo apt install \
  build-essential cmake ninja-build pkg-config \
  libgtk-4-dev \
  python3 python3-pip \
  nodejs npm
corepack enable
```

Hermes, Folly, Glog, fmt, double-conversion, and a Boost subset are fetched
and built by CMake — no system packages needed.

## Contributing

See [TODO.md](./TODO.md) for the prioritized work list. Each phase calls out
its acceptance criteria. Open issues for design questions before sending large
PRs.

## License

MIT. See [LICENSE](./LICENSE).
