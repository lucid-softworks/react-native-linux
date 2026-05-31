#!/usr/bin/env bash
# Bundle a built react-native-linux app into a .rpm (Fedora / RHEL / SUSE) package.
#
# Usage (inside the dev VM, or any Linux host with rpmbuild):
#   scripts/package/rpm.sh \
#     --app-dir apps/playground/linux/build \
#     --executable rn-linux-playground \
#     --bundle apps/playground/linux/build/assets/index.linux.bundle \
#     --vendor-bundle apps/playground/linux/build/assets/vendor.bundle \
#     --desktop apps/playground/linux/playground.desktop \
#     --name rn-linux-playground \
#     --version 0.0.1 \
#     --license MIT \
#     --summary "react-native-linux playground" \
#     --output dist/rn-linux-playground.rpm
#
# Optional:
#   --icon <path>        PNG used as the package icon (256×256 recommended)
#   --requires <csv>     Comma-separated runtime deps (default:
#                        gtk4,libsoup3)
#   --release <int>      RPM release number (default: 1)
#   --vendor <string>    "Name <email>" for the Vendor field
#
# What it does:
#   1. Stages binary + .desktop + icon + JS bundles into an rpmbuild
#      BUILDROOT layout.
#   2. Writes a .spec file with name/version/release/license/requires.
#   3. Runs `rpmbuild -bb --define '_topdir …'` to produce the .rpm.
#
# Prereqs: rpmbuild (rpm-build on Fedora/RHEL, rpm on openSUSE).
#
# The Fedora .rpm layout mirrors the .deb layout exactly: binary +
# assets at /usr/lib/<name>/, launcher at /usr/bin/<name>,
# .desktop at /usr/share/applications/, icon at the hicolor
# 256×256 slot. End users see the same install hierarchy regardless
# of distro family.
set -euo pipefail

APP_DIR=""
EXECUTABLE=""
BUNDLE=""
VENDOR_BUNDLE=""
DESKTOP=""
NAME=""
VERSION=""
RELEASE="1"
LICENSE="UNLICENSED"
SUMMARY=""
VENDOR=""
OUTPUT=""
ICON=""
REQUIRES="gtk4,libsoup3"

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
    --release)        RELEASE="$2"; shift 2 ;;
    --license)        LICENSE="$2"; shift 2 ;;
    --summary)        SUMMARY="$2"; shift 2 ;;
    --vendor)         VENDOR="$2"; shift 2 ;;
    --output)         OUTPUT="$2"; shift 2 ;;
    --icon)           ICON="$2"; shift 2 ;;
    --requires)       REQUIRES="$2"; shift 2 ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

for var in APP_DIR EXECUTABLE NAME VERSION SUMMARY OUTPUT; do
  if [[ -z "${!var}" ]]; then
    echo "Missing --${var,,} argument." >&2
    usage
    exit 1
  fi
done

if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "rpmbuild not found. Install with one of:" >&2
  echo "  Fedora/RHEL:   sudo dnf install -y rpm-build" >&2
  echo "  openSUSE:      sudo zypper install -y rpm-build" >&2
  echo "  Ubuntu (cross): sudo apt-get install -y rpm" >&2
  exit 2
fi

exe_path="${APP_DIR}/${EXECUTABLE}"
if [[ ! -x "${exe_path}" ]]; then
  echo "Executable not found at ${exe_path}." >&2
  exit 3
fi

# rpmbuild's host architecture detection. dpkg-deb's "amd64" is
# "x86_64" in RPM-land; aarch64 matches.
ARCH="$(uname -m)"
WORK_DIR="$(mktemp -d -t rnl-rpm-XXXXXX)"
trap 'rm -rf "${WORK_DIR}"' EXIT

# rpmbuild expects the standard %_topdir layout:
#   BUILD/ BUILDROOT/ RPMS/ SOURCES/ SPECS/ SRPMS/
TOPDIR="${WORK_DIR}/rpmbuild"
BUILDROOT="${TOPDIR}/BUILDROOT/${NAME}-${VERSION}-${RELEASE}.${ARCH}"
mkdir -p \
  "${TOPDIR}/BUILD" "${TOPDIR}/BUILDROOT" "${TOPDIR}/RPMS" \
  "${TOPDIR}/SOURCES" "${TOPDIR}/SPECS" "${TOPDIR}/SRPMS" \
  "${BUILDROOT}/usr/bin" \
  "${BUILDROOT}/usr/lib/${NAME}/assets" \
  "${BUILDROOT}/usr/share/applications" \
  "${BUILDROOT}/usr/share/icons/hicolor/256x256/apps"

install -m 0755 "${exe_path}" "${BUILDROOT}/usr/lib/${NAME}/${EXECUTABLE}"

if [[ -n "${BUNDLE}" ]]; then
  install -m 0644 "${BUNDLE}" "${BUILDROOT}/usr/lib/${NAME}/assets/index.linux.bundle"
fi
if [[ -n "${VENDOR_BUNDLE}" ]]; then
  install -m 0644 "${VENDOR_BUNDLE}" "${BUILDROOT}/usr/lib/${NAME}/assets/vendor.bundle"
  # Hermes .hbc form too if it's there.
  if [[ -f "${VENDOR_BUNDLE}.hbc" ]]; then
    install -m 0644 "${VENDOR_BUNDLE}.hbc" "${BUILDROOT}/usr/lib/${NAME}/assets/vendor.bundle.hbc"
  fi
fi

# Same launcher pattern as deb.sh — sets RN_BUNDLE_URL +
# RN_VENDOR_BUNDLE_URL to the installed paths and re-execs the
# binary. Users `dnf install` and just type the package name.
cat > "${BUILDROOT}/usr/bin/${NAME}" <<EOF
#!/bin/sh
# Auto-generated launcher: re-exec the app binary with RN_BUNDLE_URL
# pointing at the bundle rpmbuild installed alongside it. The C++
# runtime (vnext/src/RNLinuxHost.cpp) reads the env var; CLI flags
# get forwarded so users can still pass --debug/etc through.
RN_BUNDLE_URL="file:///usr/lib/${NAME}/assets/index.linux.bundle" \\
RN_VENDOR_BUNDLE_URL="file:///usr/lib/${NAME}/assets/vendor.bundle" \\
exec /usr/lib/${NAME}/${EXECUTABLE} "\$@"
EOF
chmod 0755 "${BUILDROOT}/usr/bin/${NAME}"

if [[ -n "${DESKTOP}" ]]; then
  install -m 0644 "${DESKTOP}" "${BUILDROOT}/usr/share/applications/${NAME}.desktop"
else
  cat > "${BUILDROOT}/usr/share/applications/${NAME}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${NAME}
Comment=${SUMMARY}
Exec=${NAME}
Icon=${NAME}
Terminal=false
Categories=Utility;
EOF
fi

if [[ -n "${ICON}" ]]; then
  install -m 0644 "${ICON}" "${BUILDROOT}/usr/share/icons/hicolor/256x256/apps/${NAME}.png"
fi

# RPM dependency list — comma-separated input gets newline-split for
# the .spec's Requires: directive. Trim whitespace so users can
# pass "gtk4, libsoup3" with the obvious spacing.
REQUIRES_BLOCK="$(echo "${REQUIRES}" | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' -e 's/^/Requires:       /')"

# Spec file. %files is required to enumerate everything the .rpm
# carries; we use directory globs to keep the list short. AutoReq is
# off so we don't pick up phantom python/glibc dep versions from the
# tiny launcher script — runtime deps live in the user-controlled
# --requires list.
cat > "${TOPDIR}/SPECS/${NAME}.spec" <<EOF
Name:           ${NAME}
Version:        ${VERSION}
Release:        ${RELEASE}
Summary:        ${SUMMARY}
License:        ${LICENSE}
${VENDOR:+Vendor:         ${VENDOR}}
BuildArch:      ${ARCH}
AutoReq:        no
${REQUIRES_BLOCK}

%description
${SUMMARY}

%files
/usr/bin/${NAME}
/usr/lib/${NAME}
/usr/share/applications/${NAME}.desktop
${ICON:+/usr/share/icons/hicolor/256x256/apps/${NAME}.png}

%changelog
* $(LC_ALL=C date '+%a %b %d %Y') ${VENDOR:-Build system <build@localhost>} - ${VERSION}-${RELEASE}
- Initial package.
EOF

# rpmbuild -bb: build binary RPM only (no source RPM).
# %_topdir override keeps all output inside our mktemp dir so we
# don't pollute ~/rpmbuild.
rpmbuild \
  --define "_topdir ${TOPDIR}" \
  --buildroot "${BUILDROOT}" \
  -bb "${TOPDIR}/SPECS/${NAME}.spec" >/dev/null

# The output filename rpmbuild picks: <name>-<version>-<release>.<arch>.rpm
BUILT_RPM="${TOPDIR}/RPMS/${ARCH}/${NAME}-${VERSION}-${RELEASE}.${ARCH}.rpm"
if [[ ! -f "${BUILT_RPM}" ]]; then
  echo "rpmbuild ran but no .rpm at ${BUILT_RPM}" >&2
  ls -la "${TOPDIR}/RPMS" >&2 || true
  exit 4
fi

mkdir -p "$(dirname "${OUTPUT}")"
install -m 0644 "${BUILT_RPM}" "${OUTPUT}"

echo "✓ ${OUTPUT}"
echo "  Install:  sudo dnf install ./${OUTPUT}"
echo "  Run:      ${NAME}"
