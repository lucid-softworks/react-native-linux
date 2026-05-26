# Contributing to react-native-linux

Thanks for your interest. This project is in its pre-MVP phase, so the most
useful contributions right now are the foundational pieces called out in
[TODO.md](./TODO.md).

## Ground rules

- This is a Fabric-only / TurboModules-only project. Pull requests that
  introduce legacy-bridge code paths will be rejected.
- Match the upstream
  [react-native-windows](https://github.com/microsoft/react-native-windows)
  layout where there is a direct analogue — it lowers the maintenance cost of
  cross-referencing the two.
- Each PR should be focused. If you discover unrelated cleanups while working
  on something, open them as separate PRs.

## Development setup

If you are on **macOS**, use the bundled Lima VM. It mounts the repo
read/write and runs an Xfce desktop you can view over VNC. See
[docs/dev-vm.md](./docs/dev-vm.md).

The instructions below assume you are already on Ubuntu 22.04 or 24.04
(either bare metal or inside the dev VM).

## Native build setup (Ubuntu 24.04)

```sh
sudo apt install \
  build-essential cmake ninja-build pkg-config \
  libgtk-4-dev \
  python3 python3-pip \
  nodejs npm
corepack enable
corepack prepare pnpm@9.15.5 --activate

git clone https://github.com/lucid-softworks/react-native-linux.git
cd react-native-linux
pnpm install
pnpm typecheck
pnpm lint
```

The native runtime is built separately:

```sh
pnpm cmake:configure   # configures vnext/build with Ninja
pnpm cmake:build       # builds — currently does NOT fully succeed; see TODO.md
```

## Repo layout

See [README.md](./README.md#repo-layout).

## Coding style

- TypeScript / JavaScript: Prettier + ESLint (`@react-native` config).
- C++: `.clang-format` at the repo root (LLVM-derived, RN-flavored). Run
  `pnpm format:cpp` before committing.
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org).
  Examples: `feat(cli): add log-linux`, `fix(vnext): correct mounting order`.

## Testing

- JS: `pnpm test` runs Jest across all workspaces. Each package's tests live in
  `__tests__/`.
- Native: GoogleTest under `vnext/tests/` (enabled with
  `-DREACT_NATIVE_LINUX_BUILD_TESTS=ON`).
- Integration / e2e: `xvfb-run` based; see `docs/troubleshooting.md` for tips.

## Submitting a PR

1. Open an issue first for design questions. Small, well-scoped PRs go fastest.
2. Branch from `main`. Keep the branch up to date by rebasing, not merging.
3. Run `pnpm lint && pnpm typecheck && pnpm test` locally. CI runs the same.
4. Fill in the PR template; reference the TODO.md item your PR closes.
5. A reviewer (see [CODEOWNERS](./CODEOWNERS)) will look at it. Be patient —
   maintainer time is finite.

## Release process

This repo uses [release-please](https://github.com/googleapis/release-please)
to cut versions from Conventional Commits. See `release-please-config.json`.

## Code of conduct

By participating, you agree to abide by the
[Code of Conduct](./CODE_OF_CONDUCT.md). In short: be kind, assume good faith.

## License

Contributions are accepted under the [MIT license](./LICENSE).
