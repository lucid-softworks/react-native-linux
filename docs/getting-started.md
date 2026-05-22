# Getting started

> **Status:** these instructions describe the **intended** UX. Until the
> native runtime builds end-to-end, `pnpm react-native run-linux` will fail
> partway through. See [TODO.md](../TODO.md) for the gates.

## Prerequisites

- Ubuntu 22.04 LTS or 24.04 LTS (other distros: probably work, untested).
- Node.js 20 LTS.
- pnpm 9 (`corepack prepare pnpm@9.12.0 --activate`).
- GTK4 development headers + Hermes build deps (see below).

```sh
sudo apt install -y \
  build-essential cmake ninja-build pkg-config \
  libgtk-4-dev libglib2.0-dev \
  python3 python3-pip
```

## Adding react-native-linux to a new app

```sh
npx @react-native-community/cli init MyApp
cd MyApp
pnpm add -D @lucid-softworks/react-native-linux @lucid-softworks/react-native-linux-cli
pnpm react-native init-linux
pnpm react-native run-linux
```

`init-linux` writes a `linux/` directory to your project with a minimal CMake
project and a `main.cpp` that boots `RNLinuxApplication`. `run-linux`:

1. Configures CMake (`cmake -B linux/build -G Ninja`).
2. Builds with Ninja.
3. Launches the executable.
4. Expects a Metro instance on `127.0.0.1:8081` — start that yourself with
   `pnpm start` in another terminal.

## What the executable does

On launch the app:

1. Reads `RN_BUNDLE_URL` (or constructs one from `RN_METRO_HOST` +
   `RN_METRO_PORT`).
2. Creates a `GtkApplicationWindow` with a `GtkFixed` root.
3. Boots `RNLinuxHost`, which:
   - Spins up the Hermes runtime on a JS thread.
   - Downloads + evaluates the bundle.
   - Mounts the root surface onto the `GtkFixed`.
4. Renders the React tree as native GTK widgets.

## Configuration knobs

Environment variables read by the default `main.cpp`:

| Var                | Default                  | Notes                                  |
| ------------------ | ------------------------ | -------------------------------------- |
| `RN_BUNDLE_URL`    | (unset)                  | Wins over `RN_METRO_HOST`/`_PORT`.     |
| `RN_METRO_HOST`    | `127.0.0.1`              | Use the host's LAN IP for VM-hosted Metro. |
| `RN_METRO_PORT`    | `8081`                   | Pass-through to Metro.                 |

You can edit `linux/main.cpp` freely — it's part of your app, not the
library.

## Production builds

```sh
pnpm react-native bundle-linux \
  --bundle-output linux/build/assets/index.linux.bundle \
  --assets-dest linux/build/assets \
  --dev false --no-minify

cmake -S linux -B linux/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build linux/build

# The executable now expects `index.linux.bundle` next to it.
ls linux/build/rn-linux-app linux/build/index.linux.bundle
```

For redistribution, see [docs/architecture.md](./architecture.md) and the
"Distribution" section of [TODO.md](../TODO.md).

## Troubleshooting

See [docs/troubleshooting.md](./troubleshooting.md).
