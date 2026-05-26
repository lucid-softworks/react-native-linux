# Troubleshooting

## CMake configure fails: "GTK4 not found"

You're missing `libgtk-4-dev`. On Ubuntu:

```sh
sudo apt install -y libgtk-4-dev libglib2.0-dev pkg-config
```

`FindGTK4.cmake` uses `pkg-config`, so the `.pc` files matter — bare GTK
binaries are not enough.

## CMake configure fails: "REACT_NATIVE_ROOT not set"

`vnext/CMakeLists.txt` needs to find React Native's C++ headers
(`ReactCommon/`). Either:

- Pass `-DREACT_NATIVE_ROOT=/path/to/node_modules/react-native`, or
- Run `pnpm install` inside `template/` first so `cmake` can default to
  `template/node_modules/react-native`.

## Hermes build is enormous

A full Hermes-from-source build allocates ~6 GiB of intermediates. If you
hit OOM:

- Reduce parallelism: `cmake --build vnext/build -j 2`.
- Increase the Lima VM's memory (see [docs/dev-vm.md](./dev-vm.md)).
- Skip Hermes entirely with `-DREACT_NATIVE_LINUX_USE_SYSTEM_HERMES=ON` if
  you have a system Hermes available (rare).

## Metro can't be reached from the app

The default `linux/main.cpp` looks at `RN_METRO_HOST` (defaulting to
`127.0.0.1`) and `RN_METRO_PORT` (defaulting to `8081`). If Metro runs on
your macOS host but the app runs inside the Lima VM, set:

```sh
export RN_METRO_HOST=host.lima.internal
```

## "Black window, no content"

Likely the JS bundle failed to evaluate. Check the app's stderr:

```sh
./rn-linux-app 2>&1 | tee /tmp/rn-linux.log
```

The first `[Hermes] evaluate(...)` line confirms Hermes saw the bundle. If
it's missing, the bundle URL is wrong or unreachable.

## VNC stays blank / connection drops

The TigerVNC unit might not have started. Inside the VM:

```sh
sudo journalctl -u rn-linux-vnc.service -n 100
```

If the unit succeeded but the screen is blank, Xfce's `xstartup` may be
crashing. Try running it manually:

```sh
DISPLAY=:1 startxfce4
```

…and watch stderr.

## CI passes locally but not on GitHub

Most likely a dependency that's vendored in your local `node_modules` was
written _after_ the lockfile. Re-run `pnpm install --frozen-lockfile` to
reproduce the CI install constraints.

## Pre-commit hooks block a commit

If a hook fails, do **not** use `--no-verify`. Read the hook output,
fix the underlying issue, re-stage, and create a new commit.

## "I just want to nuke everything and start over"

```sh
pnpm clean                       # removes vnext/build + each workspace's lib
limactl delete rn-linux          # nukes the dev VM (lots of disk back)
rm -rf node_modules **/node_modules
pnpm install
```
