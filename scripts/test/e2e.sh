#!/usr/bin/env bash
# react-native-linux end-to-end smoke test.
#
# Boots the playground (or a passed-in executable) under xvfb-run on a
# virtual X server, takes a screenshot of the window after a short
# settle delay, and (optionally) diff-tests it against a golden.
#
# Linux-only. Run from inside the Lima dev VM on macOS.
#
# Required tools:
#   xvfb-run            (xvfb package on Ubuntu)
#   import (ImageMagick) — used for the screenshot
#   compare (ImageMagick) — used for the optional diff
#
# Usage:
#   scripts/test/e2e.sh
#     --executable <path>          (default: apps/playground/linux/build/rn-linux-playground)
#     --golden <path>              (optional: path to expected PNG)
#     --output <path>              (default: dist/e2e/screenshot.png)
#     --settle-ms <int>            (default: 2000)
#     --bundle-url <url>           (optional: passed via RN_BUNDLE_URL)
#
# Exit codes:
#   0  success (and diff < threshold if --golden was supplied)
#   1  bad args / missing tools
#   2  app failed to start
#   3  screenshot failed
#   4  diff above threshold

set -euo pipefail

EXECUTABLE="apps/playground/linux/build/rn-linux-playground"
GOLDEN=""
OUTPUT="dist/e2e/screenshot.png"
SETTLE_MS=2000
BUNDLE_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --executable) EXECUTABLE="$2"; shift 2 ;;
    --golden)     GOLDEN="$2"; shift 2 ;;
    --output)     OUTPUT="$2"; shift 2 ;;
    --settle-ms)  SETTLE_MS="$2"; shift 2 ;;
    --bundle-url) BUNDLE_URL="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo pipefail/d' >&2
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "e2e.sh runs on Linux only. Use the Lima dev VM (see docs/dev-vm.md)." >&2
  exit 1
fi

for tool in xvfb-run import; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing tool: $tool" >&2
    echo "  sudo apt install -y xvfb imagemagick" >&2
    exit 1
  fi
done

if [[ ! -x "${EXECUTABLE}" ]]; then
  echo "Executable not found at ${EXECUTABLE}." >&2
  echo "Run \`pnpm cmake:build\` first, or pass --executable." >&2
  exit 2
fi

mkdir -p "$(dirname "${OUTPUT}")"

DISPLAY_FD="${XVFB_DISPLAY:-:99}"
log() { printf '[e2e] %s\n' "$*" >&2; }

# Use xvfb-run --auto-servernum so concurrent runs don't collide.
log "booting ${EXECUTABLE} under Xvfb"
env_vars=()
if [[ -n "${BUNDLE_URL}" ]]; then
  env_vars+=("RN_BUNDLE_URL=${BUNDLE_URL}")
fi

# Run the app in the background under xvfb-run so we can screenshot it
# from outside the wrapper.
log "waiting ${SETTLE_MS}ms for the window to settle"
xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" \
  bash -c "${env_vars[*]} '${EXECUTABLE}' &
           APP_PID=\$!
           sleep $(awk -v ms=\"${SETTLE_MS}\" 'BEGIN{ printf \"%.3f\", ms/1000 }')
           import -window root -display \$DISPLAY '${OUTPUT}' || (kill \$APP_PID; exit 3)
           kill \$APP_PID 2>/dev/null || true
           wait \$APP_PID 2>/dev/null || true"

if [[ ! -s "${OUTPUT}" ]]; then
  echo "Screenshot was not produced at ${OUTPUT}." >&2
  exit 3
fi
log "screenshot → ${OUTPUT}"

if [[ -n "${GOLDEN}" ]]; then
  if [[ ! -s "${GOLDEN}" ]]; then
    echo "Golden image not found at ${GOLDEN}." >&2
    exit 4
  fi
  DIFF_FILE="${OUTPUT%.png}-diff.png"
  if compare -metric AE -fuzz 2% "${OUTPUT}" "${GOLDEN}" "${DIFF_FILE}" 2>/tmp/e2e-diff.txt; then
    diff_pixels=$(cat /tmp/e2e-diff.txt | tr -d 'eE.+0-9' >/dev/null; tail -n1 /tmp/e2e-diff.txt | awk '{print $1}')
    log "pixel diff vs golden: ${diff_pixels}"
  else
    diff_pixels=$(tail -n1 /tmp/e2e-diff.txt | awk '{print $1}')
    threshold=${E2E_DIFF_THRESHOLD:-50000}
    if (( ${diff_pixels:-999999999} > threshold )); then
      echo "Screenshot diff above threshold (${diff_pixels} > ${threshold})." >&2
      echo "Diff image: ${DIFF_FILE}" >&2
      exit 4
    fi
    log "pixel diff ${diff_pixels} (within threshold ${threshold})"
  fi
fi

log "ok"
