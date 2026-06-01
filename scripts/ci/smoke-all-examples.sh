#!/usr/bin/env bash
# Iterate every example directory under external/expo-examples,
# attempt to bundle + smoke-boot each one, record pass/fail status.
#
# The expo/examples repo (MIT-licensed) ships ~70 Expo apps pinned to
# SDK 56. Each example exports a default `App` component but doesn't
# call `registerRootComponent` (Expo's CLI normally does that via
# expo/AppEntry.js). We synthesize a tiny wrapper at
# apps/playground/.smoke-entries/<name>.js that imports the default
# and registers it, then point bundle.mjs at the wrapper.
#
# Expected outcomes are bucketed in the final summary:
#   PASS         — bundle + boot both clean
#   BUNDLE_FAIL  — bundle errored (missing dep, unsupported syntax)
#   BOOT_FAIL    — bundle clean, binary crashed / log missing / blank
#   SKIPPED      — no recognisable entry file
#
# A failure in any one example doesn't fail the script — we always
# walk the full set and write the summary. CI can decide what's
# fatal via its own gating step against the summary.
#
# Usage:
#   scripts/ci/smoke-all-examples.sh
#     --executable <path>        (default: apps/playground/linux/build/rn-linux-playground)
#     --examples-dir <path>      (default: external/expo-examples)
#     --summary <path>           (default: dist/ci-smoke-examples/summary.txt)
#     --artifact-dir <path>      (default: dist/ci-smoke-examples)
#     --settle-ms <int>          (default: 4000)
#     --limit <int>              (default: 0 = no limit; useful for local dev)
#     --only <regex>             (default: empty; filter dir names)
#
# Exit codes:
#   0  always (errors are reported per-example in the summary; CI
#      decides what's fatal)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXECUTABLE="apps/playground/linux/build/rn-linux-playground"
EXAMPLES_DIR="external/expo-examples"
ARTIFACT_DIR="dist/ci-smoke-examples"
SUMMARY=""
SETTLE_MS=4000
LIMIT=0
ONLY_REGEX=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --executable)   EXECUTABLE="$2"; shift 2 ;;
    --examples-dir) EXAMPLES_DIR="$2"; shift 2 ;;
    --summary)      SUMMARY="$2"; shift 2 ;;
    --artifact-dir) ARTIFACT_DIR="$2"; shift 2 ;;
    --settle-ms)    SETTLE_MS="$2"; shift 2 ;;
    --limit)        LIMIT="$2"; shift 2 ;;
    --only)         ONLY_REGEX="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo pipefail/d' >&2
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

cd "${REPO_ROOT}"
SUMMARY="${SUMMARY:-${ARTIFACT_DIR}/summary.txt}"
WRAPPER_DIR="apps/playground/.smoke-entries"
mkdir -p "${ARTIFACT_DIR}" "${WRAPPER_DIR}"

if [[ ! -d "${EXAMPLES_DIR}" ]]; then
  echo "Examples directory not found: ${EXAMPLES_DIR}" >&2
  echo "  (Run \`git submodule update --init\` first.)" >&2
  exit 1
fi

if [[ ! -x "${EXECUTABLE}" ]]; then
  echo "Playground executable not found: ${EXECUTABLE}" >&2
  exit 1
fi

# Write the summary header up-front so the file exists even if we
# bail out mid-loop on something unexpected.
{
  printf '%-40s  %-12s  %s\n' 'EXAMPLE' 'STATUS' 'NOTES'
  printf '%-40s  %-12s  %s\n' '----------------------------------------' '------------' '----------------------------------------'
} > "${SUMMARY}"

passes=0
bundle_fails=0
boot_fails=0
skipped=0
total=0

for dir in "${EXAMPLES_DIR}"/*/; do
  name="$(basename "${dir}")"

  if [[ -n "${ONLY_REGEX}" ]] && ! [[ "${name}" =~ ${ONLY_REGEX} ]]; then
    continue
  fi
  if (( LIMIT > 0 )) && (( total >= LIMIT )); then
    break
  fi
  total=$((total + 1))

  # Detect entry shape. Two flavours:
  #   classic — App.{tsx,js} / index.{tsx,js} default-exporting a
  #             component. We wrap with registerRootComponent.
  #   router  — app/ dir with _layout.{tsx,js} / +not-found.{tsx,js}.
  #             Entry becomes `import 'expo-router/entry'`; the
  #             router scans the app/ dir.
  entry=""
  router=0
  router_root=""
  for cand in App.tsx App.js index.tsx index.js; do
    if [[ -f "${dir}${cand}" ]]; then
      entry="${dir}${cand}"
      break
    fi
  done
  if [[ -z "${entry}" && -d "${dir}app" ]]; then
    router=1
    entry="${dir}app/_layout.tsx"
    [[ -f "${entry}" ]] || entry="${dir}app/_layout.js"
    router_root="${dir}app"
  fi
  # Newer expo-router apps use a `src/app/` layout (with-graphql,
  # with-html, with-react-flow, with-tailwindcss, …). package.json
  # still points main at "expo-router/entry"; the router config is
  # what tells it to scan src/app/.
  if [[ -z "${entry}" && -d "${dir}src/app" ]]; then
    router=1
    entry="${dir}src/app/_layout.tsx"
    [[ -f "${entry}" ]] || entry="${dir}src/app/_layout.js"
    router_root="${dir}src/app"
  fi
  # Config-only example: package.json points at expo-router/entry but
  # the README leaves the routes for `npx create-expo-app -e <name>` to
  # generate. `with-router` is the canonical one. Synthesize a minimal
  # app/ dir next to the wrapper so the router has something to mount —
  # this proves expo-router + its shim boot without touching the
  # external submodule.
  if [[ -z "${entry}" && -f "${dir}package.json" ]]; then
    if grep -qE '"main"\s*:\s*"expo-router/entry"' "${dir}package.json"; then
      stub_app="${WRAPPER_DIR}/${name//\//-}-stub-app"
      mkdir -p "${stub_app}"
      cat > "${stub_app}/_layout.tsx" <<'EOF'
import {Slot} from 'expo-router';
export default function Layout() {
  return <Slot />;
}
EOF
      cat > "${stub_app}/index.tsx" <<EOF
import {Text, View} from 'react-native';
export default function Index() {
  return (
    <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0c0a09'}}>
      <Text style={{color: '#fafaf9', fontSize: 18}}>${name} stub route</Text>
    </View>
  );
}
EOF
      router=1
      entry="${stub_app}/_layout.tsx"
      router_root="${stub_app}"
    fi
  fi
  if [[ -z "${entry}" ]]; then
    printf '%-40s  %-12s  %s\n' "${name}" 'SKIPPED' 'no App / index / app entry' >> "${SUMMARY}"
    skipped=$((skipped + 1))
    continue
  fi

  # Synthesize the wrapper. The relative path keeps the bundle's
  # source map useful when triaging a failure — esbuild stamps it
  # alongside the entry file's name. registerRootComponent is
  # resolved from `expo` (in our external list → routes through
  # globalThis.__rnv); the playground's runtime calls
  # AppRegistry.runApplication to mount it.
  wrapper="${WRAPPER_DIR}/${name//\//-}.js"
  if (( router )); then
    # expo-router scans process.env.EXPO_ROUTER_APP_ROOT (or a
    # build-time string) for the routes tree. We set it to the
    # absolute path of the example's app/ dir so the router resolves
    # against the right routes even though our bundle entrypoint
    # is in apps/playground/.smoke-entries/. For config-only examples
    # (e.g. with-router) the router_root points at the synthesized
    # stub app dir under WRAPPER_DIR.
    app_dir_abs="$(cd "${router_root}" && pwd)"
    cat > "${wrapper}" <<EOF
// Auto-generated by scripts/ci/smoke-all-examples.sh — do not edit.
// expo-router smoke for ${name}.
process.env.EXPO_ROUTER_APP_ROOT = "${app_dir_abs}";
import "expo-router/entry";
EOF
  else
    entry_abs="$(cd "$(dirname "${entry}")" && pwd)/$(basename "${entry}")"
    # Some examples already call `registerRootComponent(App)` inside
    # their entry (with-react-navigation, with-storybook, …). For
    # those we side-effect-import the file so its registration runs;
    # synthesizing `import App from …` would fail to find a default
    # export. Detect by grepping for the call.
    if grep -qE 'registerRootComponent\s*\(' "${entry}"; then
      cat > "${wrapper}" <<EOF
// Auto-generated by scripts/ci/smoke-all-examples.sh — do not edit.
// Side-effect import: ${name}'s entry already calls
// registerRootComponent on its own.
import "${entry_abs}";
EOF
    else
      cat > "${wrapper}" <<EOF
// Auto-generated by scripts/ci/smoke-all-examples.sh — do not edit.
// Wraps ${name}'s default export so AppRegistry sees the component.
import App from "${entry_abs}";
import {registerRootComponent} from "expo";
registerRootComponent(App);
EOF
    fi
  fi

  echo "==> ${name} (${entry})"

  # Stage 1: bundle. Pipe stderr to a per-example log so a triage
  # can compare across the full matrix. RN_ENTRY_PATH bypasses the
  # apps/playground/ entry lookup (added in bundle.mjs for this).
  bundle_log="${ARTIFACT_DIR}/${name}.bundle.log"
  hbc_path="${REPO_ROOT}/apps/playground/linux/build/assets/index.linux.bundle.hbc"
  if ! RN_ENTRY_PATH="${REPO_ROOT}/${wrapper}" \
       node "${REPO_ROOT}/apps/playground/bundle.mjs" > "${bundle_log}" 2>&1; then
    notes=$(grep -m1 -E 'error:|Error:|ENOENT|Cannot resolve' "${bundle_log}" | head -1 | tr -d '\r' | cut -c1-60)
    printf '%-40s  %-12s  %s\n' "${name}" 'BUNDLE_FAIL' "${notes:-see bundle.log}" >> "${SUMMARY}"
    bundle_fails=$((bundle_fails + 1))
    continue
  fi
  # bundle.mjs exits 0 even when hermesc rejected the app .hbc
  # (the wipe-on-failure path leaves the .js bundle in place so a
  # dev iterating locally still gets fast refresh from JS source).
  # That's not a smoke pass — a missing .hbc means the example's JS
  # didn't compile cleanly. Treat as BUNDLE_FAIL.
  if [[ ! -s "${hbc_path}" ]]; then
    notes=$(grep -m1 -E '\[hermesc\] app failed' "${bundle_log}" | head -1 | tr -d '\r' | cut -c1-60)
    printf '%-40s  %-12s  %s\n' "${name}" 'BUNDLE_FAIL' "${notes:-hbc missing}" >> "${SUMMARY}"
    bundle_fails=$((bundle_fails + 1))
    continue
  fi

  # Stage 2: smoke. Reuse the existing scripts/ci/smoke-playground.sh
  # against the freshly-built .hbc. Per-example screenshot + app.log
  # go under the artifact dir; the smoke script's own exit code
  # tells us pass vs which kind of fail.
  smoke_log="${ARTIFACT_DIR}/${name}.smoke.log"
  # Per-example window title so anyone watching the matrix live can
  # tell which app is on screen at a given moment. RN_WINDOW_TITLE
  # is consumed by apps/playground/linux/main.cpp at startup.
  if RN_WINDOW_TITLE="rnl-matrix · ${name}" bash "${REPO_ROOT}/scripts/ci/smoke-playground.sh" \
       --executable "${REPO_ROOT}/${EXECUTABLE}" \
       --bundle-url "file://${REPO_ROOT}/apps/playground/linux/build/assets/index.linux.bundle.hbc" \
       --settle-ms "${SETTLE_MS}" \
       --output "${ARTIFACT_DIR}/${name}.png" \
       --log "${ARTIFACT_DIR}/${name}.app.log" \
       > "${smoke_log}" 2>&1; then
    printf '%-40s  %-12s  %s\n' "${name}" 'PASS' '' >> "${SUMMARY}"
    passes=$((passes + 1))
  else
    notes=$(grep -m1 -E '\[smoke\]' "${smoke_log}" | tail -1 | tr -d '\r' | cut -c1-60)
    printf '%-40s  %-12s  %s\n' "${name}" 'BOOT_FAIL' "${notes:-see smoke.log}" >> "${SUMMARY}"
    boot_fails=$((boot_fails + 1))
  fi
done

# Final stats block — easy to diff between runs to spot regressions
# without parsing the per-row table.
{
  printf '\n'
  printf 'TOTALS: %d examples\n' "${total}"
  printf '  PASS        : %d\n' "${passes}"
  printf '  BUNDLE_FAIL : %d\n' "${bundle_fails}"
  printf '  BOOT_FAIL   : %d\n' "${boot_fails}"
  printf '  SKIPPED     : %d\n' "${skipped}"
} >> "${SUMMARY}"

cat "${SUMMARY}"
echo ""
echo "Summary written to ${SUMMARY}"
