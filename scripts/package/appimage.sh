#!/usr/bin/env bash
# Bundle a built react-native-linux app into a self-contained AppImage.
#
# Usage (inside the dev VM, or any Linux host):
#   scripts/package/appimage.sh \
#     --app-dir template/linux/build \
#     --executable rn-linux-app \
#     --desktop template/linux/app.desktop \
#     --output dist/rn-linux-app.AppImage
#
# Optional:
#   --icon <path>           PNG used as the AppImage icon (256x256 recommended)
#   --bundle <path>         JS bundle file to include alongside the executable
#   --no-fetch              Skip downloading linuxdeploy + appimagetool
#
# What it does:
#   1. Stages the executable + .desktop + icon + JS bundle into an AppDir.
#   2. Runs linuxdeploy to copy ELF dependencies and write the AppRun stub.
#   3. Runs appimagetool to compress the AppDir into a runnable AppImage.
#
# Prereqs: a Linux host (the AppImage tooling does not run on macOS — use
# the Lima dev VM, see docs/dev-vm.md). curl + libfuse2 must be available
# so the resulting AppImage is executable.

set -euo pipefail

APP_DIR=""
EXECUTABLE=""
DESKTOP=""
OUTPUT=""
ICON=""
BUNDLE=""
NO_FETCH="false"

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo pipefail/d' >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)    APP_DIR="$2"; shift 2 ;;
    --executable) EXECUTABLE="$2"; shift 2 ;;
    --desktop)    DESKTOP="$2"; shift 2 ;;
    --output)     OUTPUT="$2"; shift 2 ;;
    --icon)       ICON="$2"; shift 2 ;;
    --bundle)     BUNDLE="$2"; shift 2 ;;
    --no-fetch)   NO_FETCH="true"; shift ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

for var in APP_DIR EXECUTABLE DESKTOP OUTPUT; do
  if [[ -z "${!var}" ]]; then
    echo "Missing --${var,,} argument." >&2
    usage
    exit 1
  fi
done

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "AppImage packaging only runs on Linux. Use the Lima dev VM (see docs/dev-vm.md)." >&2
  exit 2
fi

exe_path="${APP_DIR}/${EXECUTABLE}"
if [[ ! -x "${exe_path}" ]]; then
  echo "Executable not found at ${exe_path}. Run \`pnpm cmake:build\` first." >&2
  exit 3
fi

WORK_DIR="$(mktemp -d -t rnl-appimage-XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

APPDIR="${WORK_DIR}/AppDir"
mkdir -p "${APPDIR}/usr/bin" "${APPDIR}/usr/share/applications" "${APPDIR}/usr/share/icons/hicolor/256x256/apps"

cp "${exe_path}" "${APPDIR}/usr/bin/${EXECUTABLE}"
cp "${DESKTOP}" "${APPDIR}/usr/share/applications/${EXECUTABLE}.desktop"

if [[ -n "${ICON}" ]]; then
  cp "${ICON}" "${APPDIR}/usr/share/icons/hicolor/256x256/apps/${EXECUTABLE}.png"
else
  # Placeholder transparent PNG so linuxdeploy doesn't complain.
  printf '\x89PNG\r\n\x1a\n' > "${APPDIR}/usr/share/icons/hicolor/256x256/apps/${EXECUTABLE}.png"
fi

if [[ -n "${BUNDLE}" ]]; then
  cp "${BUNDLE}" "${APPDIR}/usr/bin/index.linux.bundle"
fi

TOOL_DIR="${WORK_DIR}/tools"
mkdir -p "${TOOL_DIR}"

fetch_tool() {
  local name="$1" url="$2"
  local out="${TOOL_DIR}/${name}"
  if [[ -x "${out}" ]]; then return; fi
  echo "▸ Fetching ${name}"
  curl -fLs "${url}" -o "${out}"
  chmod +x "${out}"
}

if [[ "${NO_FETCH}" != "true" ]]; then
  fetch_tool linuxdeploy \
    "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-$(uname -m).AppImage"
  fetch_tool appimagetool \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-$(uname -m).AppImage"
fi

echo "▸ Running linuxdeploy"
"${TOOL_DIR}/linuxdeploy" \
  --appdir "${APPDIR}" \
  --executable "${APPDIR}/usr/bin/${EXECUTABLE}" \
  --desktop-file "${APPDIR}/usr/share/applications/${EXECUTABLE}.desktop" \
  --icon-file "${APPDIR}/usr/share/icons/hicolor/256x256/apps/${EXECUTABLE}.png"

echo "▸ Compressing AppImage → ${OUTPUT}"
mkdir -p "$(dirname "${OUTPUT}")"
"${TOOL_DIR}/appimagetool" "${APPDIR}" "${OUTPUT}"

echo "✓ ${OUTPUT}"
