#!/usr/bin/env bash
# Boot (or resume) the react-native-linux dev VM via Lima.
set -euo pipefail

VM_NAME="${RN_LINUX_VM_NAME:-rn-linux}"
TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/react-native-linux.yaml"

if ! command -v limactl >/dev/null 2>&1; then
  echo "limactl not found. Install Lima first:" >&2
  echo "  brew install lima" >&2
  exit 1
fi

if limactl list --quiet 2>/dev/null | grep -qx "${VM_NAME}"; then
  echo "▸ resuming existing VM '${VM_NAME}'"
  limactl start "${VM_NAME}"
else
  echo "▸ creating VM '${VM_NAME}' (first boot will take ~5-10 min)"
  limactl create --name="${VM_NAME}" "${TEMPLATE}"
  limactl start "${VM_NAME}"
fi

cat <<'POSTBOOT'

✓ VM running.
  Connect to the desktop:    open vnc://127.0.0.1:5901   (password: rnlinux)
  Open a shell:              scripts/vm/shell.sh
  Stop the VM:               limactl stop rn-linux
POSTBOOT
