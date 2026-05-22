#!/usr/bin/env bash
# Run the full configure + build cycle inside the dev VM.
# Exits non-zero if anything fails — useful as a CI-parity check from macOS.
set -euo pipefail

VM_NAME="${RN_LINUX_VM_NAME:-rn-linux}"
MOUNT_PATH="/workspaces/react-native-linux"

if ! limactl list --quiet 2>/dev/null | grep -qx "${VM_NAME}"; then
  echo "VM '${VM_NAME}' does not exist. Run scripts/vm/start.sh first." >&2
  exit 1
fi

limactl shell --workdir "${MOUNT_PATH}" "${VM_NAME}" bash -lc '
  set -euo pipefail
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm lint
  cmake -S vnext -B vnext/build -G Ninja \
    -DCMAKE_BUILD_TYPE=Debug \
    -DREACT_NATIVE_ROOT="$PWD/template/node_modules/react-native"
  # The full build is not yet expected to succeed end-to-end. Comment in
  # `cmake --build vnext/build` once the Fabric headers are wired.
'
