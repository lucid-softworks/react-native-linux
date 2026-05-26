# Developing on macOS with a Linux VM

react-native-linux only runs on Linux. macOS contributors get a near-CI-parity
environment via [Lima](https://lima-vm.io/) — a free, fast VM manager for
macOS that runs Ubuntu under QEMU (or Apple's Virtualization framework on
Apple Silicon).

The VM provides:

- Ubuntu 24.04 LTS (the canonical target).
- The full GTK4 + Hermes build toolchain.
- TigerVNC + Xfce so you can **see** the app you're building. Connect from
  macOS's built-in `vnc://` viewer.
- The repo bind-mounted at `/workspaces/react-native-linux` — edits on macOS show up
  inside the VM immediately, no sync step.

## Disk-space reality check

Lima images are sparse qcow2 files, so 30 GiB allocated ≠ 30 GiB used. A
fresh VM is ~3-4 GiB. A full Hermes-from-source build inside the VM adds
another ~6-10 GiB. Plan for ~12 GiB on disk after the first complete build.

If you're low on space, prune the build dir between cycles:

```sh
scripts/vm/shell.sh -- rm -rf react-native-linux/vnext/build
```

## One-time setup

1. Install Lima:

   ```sh
   brew install lima
   ```

2. Boot the VM. The first run downloads the Ubuntu cloud image and
   provisions GTK4, TigerVNC, Xfce, and pnpm — expect 5-10 minutes.

   ```sh
   ./scripts/vm/start.sh
   ```

3. Connect to the desktop:

   ```sh
   ./scripts/vm/vnc.sh
   # password: rnlinux
   ```

   macOS opens `Screen Sharing.app` against `127.0.0.1:5901`. Xfce greets
   you with an empty desktop and a terminal.

## Day-to-day workflow

```sh
./scripts/vm/start.sh           # boot if stopped
./scripts/vm/shell.sh           # drop into a shell in the mounted repo
./scripts/vm/build.sh           # full lint + typecheck + cmake configure
./scripts/vm/vnc.sh             # open the GUI to run the app visually
./scripts/vm/stop.sh            # shut down (state persists)
```

To run the sample app from inside the VNC session:

```sh
# In a terminal inside Xfce
cd /workspaces/react-native-linux
pnpm install
pnpm cmake:configure
pnpm cmake:build               # currently does NOT yet succeed end-to-end
cd template/linux/build
./rn-linux-app
```

## Resource tuning

Defaults in [react-native-linux.yaml](../scripts/vm/react-native-linux.yaml):

| Resource | Default  | Notes                                               |
| -------- | -------- | --------------------------------------------------- |
| CPUs     | 4        | Hermes build parallelism scales linearly.           |
| Memory   | 6 GiB    | Hermes peak is ~4 GiB; smaller risks OOM.           |
| Disk     | 30 GiB   | Sparse — only allocates as written.                 |
| Display  | 1440×900 | Edit the `tigervncserver -geometry` line to change. |

To resize an existing VM, edit the YAML then:

```sh
limactl stop rn-linux
limactl edit rn-linux              # opens $EDITOR with current config
limactl start rn-linux
```

## Networking

Two host ports are forwarded by default:

- `5901` → VNC (`vnc://127.0.0.1:5901`)
- `8081` → Metro (if you run `pnpm start` inside the VM)

If you'd rather run Metro on macOS and have the VM connect out, set
`RN_METRO_HOST=host.lima.internal` inside the VM before launching the app.

## Headless / CI-parity runs

If you only want headless tests (CI parity), skip VNC entirely and use
`xvfb-run` inside the VM:

```sh
./scripts/vm/shell.sh
xvfb-run -a ./rn-linux-app   # exits when the app does
```

The CI workflow uses the same approach — see `.github/workflows/ci.yml`.

## Troubleshooting

**`limactl: command not found`** — `brew install lima`, then re-run.

**VNC connection refused** — the systemd unit `rn-linux-vnc.service` may
have failed. Check it:

```sh
./scripts/vm/shell.sh -- sudo journalctl -u rn-linux-vnc.service -n 50
```

**Build OOMs** — drop the parallelism (`cmake --build vnext/build -j 2`) or
edit the YAML to allocate more memory.

**Mount looks empty inside the VM** — sshfs mounts initialize on first
access; `cd /workspaces/react-native-linux && ls` should populate it. If still empty,
`limactl stop && limactl start` re-runs the mount.

**VM won't fit** — drop the `disk: "30GiB"` to `"20GiB"` _before_ the first
boot. After creation, shrinking is hard; recreate the VM instead
(`limactl delete rn-linux`).
