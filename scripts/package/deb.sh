#!/usr/bin/env bash
# Bundle a built react-native-linux app into a .deb (Debian / Ubuntu) package.
#
# Usage (inside the dev VM, or any Linux host with dpkg-deb):
#   scripts/package/deb.sh \
#     --app-dir apps/playground/linux/build \
#     --executable rn-linux-playground \
#     --bundle apps/playground/linux/build/assets/index.linux.bundle \
#     --vendor-bundle apps/playground/linux/build/assets/vendor.bundle \
#     --desktop apps/playground/linux/playground.desktop \
#     --name rn-linux-playground \
#     --version 0.0.1 \
#     --maintainer "Luna <xo@wvvw.me>" \
#     --description "react-native-linux playground" \
#     --output dist/rn-linux-playground.deb
#
# Optional:
#   --icon <path>        PNG used as the package icon (256×256 recommended)
#   --depends <csv>      Comma-separated runtime apt deps (default:
#                        libgtk-4-1,libsoup-3.0-0,libgcc-s1,libstdc++6,libc6)
#
# What it does:
#   1. Stages binary + .desktop + icon + JS bundles into a debian/ layout.
#   2. Writes DEBIAN/control describing name/version/arch/depends.
#   3. Runs dpkg-deb --build to produce the .deb.
#
# Prereqs: dpkg-deb (debian-utils on most distros; pre-installed on Ubuntu).

set -euo pipefail

APP_DIR=""
EXECUTABLE=""
BUNDLE=""
VENDOR_BUNDLE=""
DESKTOP=""
NAME=""
VERSION=""
MAINTAINER=""
DESCRIPTION=""
OUTPUT=""
ICON=""
DEPENDS="libgtk-4-1,libsoup-3.0-0,libgcc-s1,libstdc++6,libc6"

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo pipefail/d' >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)        APP_DIR="$2"; shift 2 ;;
    --executable)     EXECUTABLE="$2"; shift 2 ;;
    --bundle)         BUNDLE="$2"; shift 2 ;;
    --vendor-bundle)  VENDOR_BUNDLE="$2"; shift 2 ;;
    --desktop)        DESKTOP="$2"; shift 2 ;;
    --name)           NAME="$2"; shift 2 ;;
    --version)        VERSION="$2"; shift 2 ;;
    --maintainer)     MAINTAINER="$2"; shift 2 ;;
    --description)    DESCRIPTION="$2"; shift 2 ;;
    --output)         OUTPUT="$2"; shift 2 ;;
    --icon)           ICON="$2"; shift 2 ;;
    --depends)        DEPENDS="$2"; shift 2 ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

for var in APP_DIR EXECUTABLE NAME VERSION MAINTAINER DESCRIPTION OUTPUT; do
  if [[ -z "${!var}" ]]; then
    echo "Missing --${var,,} argument." >&2
    usage
    exit 1
  fi
done

if ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "dpkg-deb not found. Install with: sudo apt-get install dpkg-dev" >&2
  exit 2
fi

exe_path="${APP_DIR}/${EXECUTABLE}"
if [[ ! -x "${exe_path}" ]]; then
  echo "Executable not found at ${exe_path}." >&2
  exit 3
fi

ARCH="$(dpkg --print-architecture)"
WORK_DIR="$(mktemp -d -t rnl-deb-XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

PKG_ROOT="${WORK_DIR}/${NAME}_${VERSION}_${ARCH}"
mkdir -p \
  "${PKG_ROOT}/DEBIAN" \
  "${PKG_ROOT}/usr/bin" \
  "${PKG_ROOT}/usr/lib/${NAME}/assets" \
  "${PKG_ROOT}/usr/share/applications" \
  "${PKG_ROOT}/usr/share/icons/hicolor/256x256/apps"

# Binary lives at /usr/lib/<name>/ so we can ship its assets alongside
# without polluting /usr/bin. A tiny launcher script at /usr/bin
# re-execs it with the right RN_BUNDLE_URL pointing at the installed
# bundle path.
install -m 0755 "${exe_path}" "${PKG_ROOT}/usr/lib/${NAME}/${EXECUTABLE}"

if [[ -n "${BUNDLE}" ]]; then
  install -m 0644 "${BUNDLE}" "${PKG_ROOT}/usr/lib/${NAME}/assets/index.linux.bundle"
fi
if [[ -n "${VENDOR_BUNDLE}" ]]; then
  install -m 0644 "${VENDOR_BUNDLE}" "${PKG_ROOT}/usr/lib/${NAME}/assets/vendor.bundle"
  # Hermes .hbc form too if it's there.
  if [[ -f "${VENDOR_BUNDLE}.hbc" ]]; then
    install -m 0644 "${VENDOR_BUNDLE}.hbc" "${PKG_ROOT}/usr/lib/${NAME}/assets/vendor.bundle.hbc"
  fi
fi

cat > "${PKG_ROOT}/usr/bin/${NAME}" <<EOF
#!/bin/sh
# Auto-generated launcher: re-exec the app binary with RN_BUNDLE_URL
# pointing at the bundle dpkg-deb installed alongside it. The C++
# runtime (vnext/src/RNLinuxHost.cpp) reads the env var; CLI flags
# get forwarded so users can still pass --debug/etc through.
RN_BUNDLE_URL="file:///usr/lib/${NAME}/assets/index.linux.bundle" \\
RN_VENDOR_BUNDLE_URL="file:///usr/lib/${NAME}/assets/vendor.bundle" \\
exec /usr/lib/${NAME}/${EXECUTABLE} "\$@"
EOF
chmod 0755 "${PKG_ROOT}/usr/bin/${NAME}"

if [[ -n "${DESKTOP}" ]]; then
  install -m 0644 "${DESKTOP}" "${PKG_ROOT}/usr/share/applications/${NAME}.desktop"
else
  # Synthesize a minimal .desktop so the app shows in menus / launchers.
  cat > "${PKG_ROOT}/usr/share/applications/${NAME}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${NAME}
Comment=${DESCRIPTION}
Exec=${NAME}
Icon=${NAME}
Terminal=false
Categories=Utility;
EOF
fi

if [[ -n "${ICON}" ]]; then
  install -m 0644 "${ICON}" "${PKG_ROOT}/usr/share/icons/hicolor/256x256/apps/${NAME}.png"
fi

# Installed-Size in KB (dpkg-deb computes Architecture / Maintainer
# from control; Installed-Size is convention).
INSTALLED_SIZE_KB="$(du -sk "${PKG_ROOT}" | cut -f1)"

cat > "${PKG_ROOT}/DEBIAN/control" <<EOF
Package: ${NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: ${MAINTAINER}
Depends: ${DEPENDS}
Installed-Size: ${INSTALLED_SIZE_KB}
Description: ${DESCRIPTION}
EOF

mkdir -p "$(dirname "${OUTPUT}")"
dpkg-deb --root-owner-group --build "${PKG_ROOT}" "${OUTPUT}"

echo "✓ ${OUTPUT}"
echo "  Install:  sudo apt install ./${OUTPUT}"
echo "  Run:      ${NAME}"
