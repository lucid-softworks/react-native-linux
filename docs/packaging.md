# Packaging a react-native-linux app

The `react-native-linux-cli` ships a `pack-linux` subcommand that wraps the format-specific scripts in `scripts/package/`. Output goes to `dist/` by default.

## `.deb` (Debian / Ubuntu)

```sh
react-native pack-linux \
  --target=deb \
  --app-dir=linux/build \
  --executable=my-app \
  --bundle=linux/build/assets/index.linux.bundle \
  --vendor-bundle=linux/build/assets/vendor.bundle \
  --maintainer="You <you@example.com>"
```

What it does:

1. Lays out a debian/ tree: `usr/bin/<name>` (shell launcher that sets `RN_BUNDLE_URL` / `RN_VENDOR_BUNDLE_URL` then `exec`s the binary), `usr/lib/<name>/<binary>` + `assets/`, `usr/share/applications/<name>.desktop`.
2. Writes `DEBIAN/control` with `Depends: libgtk-4-1, libsoup-3.0-0, libgcc-s1, libstdc++6, libc6` (override with `--depends`).
3. Runs `dpkg-deb --root-owner-group --build`.

Result installs via `sudo apt install ./dist/<name>_<version>_<arch>.deb`. Users can then run the app from their menu or `<name>` on the command line.

### Defaults pulled from `package.json`

`--name`, `--version`, `--description`, and `--maintainer` (from `author`) are read from your project's `package.json` if not passed. The `--name` is sanitized for dpkg (lowercased, scope prefix dropped, `_` → `-`).

### Prereqs

`dpkg-deb`. On Ubuntu / Debian: `sudo apt-get install dpkg-dev`. The CLI does not call `apt` itself — the resulting `.deb` is just a file.

## AppImage

```sh
react-native pack-linux \
  --target=appimage \
  --app-dir=linux/build \
  --executable=my-app \
  --desktop=linux/my-app.desktop \
  --icon=linux/icon.png \
  --bundle=linux/build/assets/index.linux.bundle
```

The script (`scripts/package/appimage.sh`) downloads `linuxdeploy` + `appimagetool` (skip with `--no-fetch` if you've pre-staged them in `$PATH`) and produces a single-file `.AppImage` users can `chmod +x` and run.

Prereqs: a Linux host (the AppImage tooling does not run on macOS — use the Lima dev VM, see `docs/dev-vm.md`).

## Not yet supported

- **Flatpak** — needs a manifest + `flatpak-builder`. Skeleton would live at `scripts/package/flatpak.sh` and a manifest template at `templates/flatpak/manifest.json`. Open for contribution.
- **Snap** — `snapcraft` + `snapcraft.yaml` template.
- **`.rpm`** — `rpmbuild` + a `.spec` template.

Each follows the same pattern as `deb.sh`: take a built binary directory + bundle paths + identity (name/version/maintainer), produce a package file in `dist/`.
