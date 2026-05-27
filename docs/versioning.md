# Versioning policy

react-native-linux **tracks the upstream React Native minor version**. The
version string is `0.X.Y` where:

| Component | Meaning                                             |
| --------- | --------------------------------------------------- |
| `0`       | Major. Stays `0` until the platform leaves pre-MVP. |
| `X`       | RN minor we target (e.g. `0.81` ↔ `0.81.x`).        |
| `Y`       | Patch. Bumped for bug fixes, doc updates, and CI.   |

When upstream RN cuts a new minor (`0.77`, `0.78`, ...), we cut a new
react-native-linux minor against the matching RN tag. Old minors continue
to receive critical fixes until two newer RN minors have shipped.

## Examples

| react-native-linux | Compatible RN        | Notes                                                       |
| ------------------ | -------------------- | ----------------------------------------------------------- |
| `0.81.0`           | `react-native@^0.81` | Current target.                                             |
| `0.81.1`           | `react-native@^0.81` | Fix in `vnext`.                                             |
| `0.82.0`           | `react-native@^0.82` | New RN minor; possible breaking changes for native modules. |

A breaking change _within_ a single RN minor (e.g. dropping support for an
older Hermes patch tag) goes out as a `0.X.0` major bump in the
**react-native-linux** sense (next RN minor) — we don't bump the leading
zero. We document the breakage in the changelog and tag the release with
a `BREAKING CHANGE:` footer in the corresponding Conventional Commit.

## Packages

The two npm packages move together — `@lucid-softworks/react-native-linux`
and `@lucid-softworks/react-native-linux-cli` always publish the same
version. release-please's `node-workspace` plugin enforces this.

## Pre-releases

Pre-MVP work happens on `0.0.x` until the first end-to-end "Hello, RN
Linux" window opens. After that, the first published version aligns with
the RN minor we validated against.

For nightly / canary builds, we publish `0.X.Y-next.N` tags off `main`
when needed; consumers opt in via `npm install
@lucid-softworks/react-native-linux@next`.

## How a release happens

1. Commits land on `main` with Conventional Commit prefixes
   (`feat`/`fix`/`chore`/`docs`/...).
2. release-please opens a long-running "release PR" listing the changelog
   delta for each bumped package.
3. Merging the release PR creates GitHub Releases + tags
   (`@lucid-softworks/react-native-linux-v0.X.Y`).
4. The `release-please` workflow then publishes the bumped packages to
   npm with provenance enabled.

Manual publishes are not allowed — provenance attestations require the
release-please-managed tag for traceability.
