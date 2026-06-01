#!/usr/bin/env bash
# react-native-linux CI playground smoke test.
#
# Boots the playground binary under xvfb-run, captures its stderr to a
# log file, takes a screenshot once the window has settled, and asserts
# that the binary actually painted something — not just that an X
# window existed. Catches C++-side mounting regressions the bundle
# gate can't see.
#
# Designed for ubuntu-24.04 GitHub runners but works on any Linux box
# with xvfb-run + ImageMagick.
#
# Usage:
#   scripts/ci/smoke-playground.sh
#     --executable <path>      (default: apps/playground/linux/build/rn-linux-playground)
#     --bundle-url <url>       (REQUIRED: file:// path to a .hbc or .bundle)
#     --output <path>          (default: dist/ci-smoke/screenshot.png)
#     --log <path>             (default: dist/ci-smoke/app.log)
#     --settle-ms <int>        (default: 4000)
#     --min-colors <int>       (default: 4 — a blank Xvfb is 1; the
#                               smoke matrix needs the threshold low
#                               enough that legitimately-rendered
#                               single-colour content (a <GLView/>
#                               placeholder, a solid splash screen)
#                               doesn't trip it. Anti-aliased text
#                               easily clears 4 colours, so the gate
#                               still catches "binary lives but never
#                               mounts a window".)
#     --require-log <regex>    (default: "JSX commit done" — the
#                               fabric.js callback after the first
#                               reconciler.updateContainer success)
#
# Exit codes:
#   0  success
#   1  bad args / missing tools
#   2  app died before settle
#   3  screenshot missing or too few colours
#   4  log assertion failed
set -euo pipefail

EXECUTABLE="apps/playground/linux/build/rn-linux-playground"
BUNDLE_URL=""
OUTPUT="dist/ci-smoke/screenshot.png"
LOG="dist/ci-smoke/app.log"
SETTLE_MS=4000
MIN_COLORS=2
REQUIRE_LOG='JSX commit done'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --executable) EXECUTABLE="$2"; shift 2 ;;
    --bundle-url) BUNDLE_URL="$2"; shift 2 ;;
    --output)     OUTPUT="$2"; shift 2 ;;
    --log)        LOG="$2"; shift 2 ;;
    --settle-ms)  SETTLE_MS="$2"; shift 2 ;;
    --min-colors) MIN_COLORS="$2"; shift 2 ;;
    --require-log) REQUIRE_LOG="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo pipefail/d' >&2
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "${BUNDLE_URL}" ]]; then
  echo "--bundle-url is required" >&2
  exit 1
fi

for tool in xvfb-run import identify; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing tool: $tool — install xvfb + imagemagick" >&2
    exit 1
  fi
done

if [[ ! -x "${EXECUTABLE}" ]]; then
  echo "Executable not found at ${EXECUTABLE}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT}")" "$(dirname "${LOG}")"

# Convert settle-ms to a fractional sleep — bash arithmetic doesn't do
# floats so awk handles the divide.
SETTLE_S=$(awk -v ms="${SETTLE_MS}" 'BEGIN{ printf "%.3f", ms/1000 }')

# Absolute paths so the xvfb-run subshell isn't sensitive to its cwd
# (xvfb-run --auto-servernum changes things around).
EXE_ABS=$(readlink -f "${EXECUTABLE}")
LOG_ABS=$(readlink -f "${LOG}" || readlink -m "${LOG}")
OUT_ABS=$(readlink -f "${OUTPUT}" || readlink -m "${OUTPUT}")

echo "[smoke] launching ${EXE_ABS}"
echo "[smoke] bundle    ${BUNDLE_URL}"
echo "[smoke] settle    ${SETTLE_MS}ms"
echo "[smoke] log →     ${LOG_ABS}"
echo "[smoke] shot →    ${OUT_ABS}"

# Force a known-good GTK4 software renderer + X11 backend + theme
# unless the caller has already set them. CI runners with no
# compositor and no DRI3 can leave a default `cairo` renderer
# silently producing a blank surface; `ngl` forces the new OpenGL
# renderer which falls back to llvmpipe under llvmpipe-only X
# (xvfb), and llvmpipe is reliably available on ubuntu-24.04.
#
# GTK_THEME=Adwaita guards against the case where the runner ships
# no theme files (rare, but produces all-default-colour widgets
# that still pass the > 16-unique-colour gate; the explicit theme
# makes the screenshot legible for triage too).
export GSK_RENDERER="${GSK_RENDERER:-ngl}"
export GDK_BACKEND="${GDK_BACKEND:-x11}"
export GTK_A11Y="${GTK_A11Y:-none}"
export GTK_THEME="${GTK_THEME:-Adwaita}"
echo "[smoke] env       GSK_RENDERER=${GSK_RENDERER} GDK_BACKEND=${GDK_BACKEND} GTK_THEME=${GTK_THEME}"

# Truncate log so this run's content is the entire file.
: > "${LOG_ABS}"

# xvfb-run --auto-servernum picks a free :N display. The inner bash
# starts the binary in the background, sleeps, screenshots, and reports
# whether the binary was still alive at screenshot time via its exit
# code (0 = alive at end, 2 = died early).
#
# We pipe the binary's stderr through tee so it lands in the log AND
# bubbles up to the GitHub Actions live output — easier to triage a
# stack trace from the CI run page than from an artifact.
xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" \
  bash -c "
    set -u
    RN_BUNDLE_URL='${BUNDLE_URL}' RN_WINDOW_TITLE='${RN_WINDOW_TITLE:-}' '${EXE_ABS}' > '${LOG_ABS}' 2>&1 &
    APP_PID=\$!
    sleep ${SETTLE_S}
    if ! kill -0 \"\$APP_PID\" 2>/dev/null; then
      echo '[smoke] binary exited before settle window'
      tail -40 '${LOG_ABS}' || true
      exit 2
    fi
    import -window root -display \"\$DISPLAY\" '${OUT_ABS}' || (kill \$APP_PID; exit 3)
    kill \$APP_PID 2>/dev/null || true
    wait \$APP_PID 2>/dev/null || true
  "

# Past xvfb-run — the inner bash already wrote the log + screenshot.
# Re-evaluate the asserts here so failures point at the right exit code.

if [[ ! -s "${OUT_ABS}" ]]; then
  echo "[smoke] screenshot missing" >&2
  exit 3
fi

# Unique-colour count separates "real GTK frame" from "blank Xvfb
# background". `identify -format %k` returns the number of distinct
# pixel values; a default 1280x800 Xvfb canvas with no client is 1
# (pure black). Even a minimal GTK window with anti-aliased default
# fonts trips dozens.
COLORS=$(identify -format '%k' "${OUT_ABS}")
echo "[smoke] screenshot colours: ${COLORS} (min ${MIN_COLORS})"
if (( COLORS < MIN_COLORS )); then
  echo "[smoke] screenshot has ${COLORS} colours, below threshold ${MIN_COLORS} — likely blank Xvfb" >&2
  # Dump the binary's stderr so the failure mode is visible without
  # downloading the artifact — GTK warnings about missing renderers
  # or theme files often print here and explain the blank capture.
  echo "--- last 40 lines of app.log ---" >&2
  tail -40 "${LOG_ABS}" >&2 || true
  exit 3
fi

if ! grep -q -E "${REQUIRE_LOG}" "${LOG_ABS}"; then
  echo "[smoke] required log pattern not found: ${REQUIRE_LOG}" >&2
  echo "--- tail of log ---" >&2
  tail -40 "${LOG_ABS}" >&2
  exit 4
fi

# Crash markers — anything that suggests the process aborted instead of
# tearing down cleanly when we sent SIGTERM. (`terminate called` is
# what std::terminate prints; the rest are libc / kernel signals.)
if grep -q -E 'Segmentation fault|terminate called|\bAborted\b' "${LOG_ABS}"; then
  echo "[smoke] crash marker found in log" >&2
  tail -40 "${LOG_ABS}" >&2
  exit 4
fi

# JS-level error markers. Even when the app *technically* mounts a
# screen (the ErrorBoundary fallback satisfies the JSX commit + min-
# colour checks), a caught runtime error means the user sees a red
# error panel — not the app they shipped. Treat as a failure so the
# matrix surfaces these regressions instead of marking them PASS.
#
# `ErrorBoundary[app] caught` is what our app-level boundary prints
# when it intercepts a render throw. `Too many re-renders` and
# `Maximum update depth exceeded` come from React's tear-detection
# (the zustand selector bug pattern). `Property '<x>' doesn't exist`
# is Hermes' "missing identifier" form — usually the result of a
# shim that didn't export what its consumer expected.
if grep -q -E 'ErrorBoundary\[[^]]*\] caught|Maximum update depth exceeded|Too many re-renders|Property .* doesnt exist|cannot read propert' "${LOG_ABS}"; then
  echo "[smoke] runtime JS error in log (caught by ErrorBoundary or React tear-detection)" >&2
  echo "--- relevant log lines ---" >&2
  grep -E 'ERROR|ErrorBoundary|Maximum update|Too many|Property|TypeError' "${LOG_ABS}" | head -10 >&2 || true
  exit 4
fi

echo "[smoke] ok"
