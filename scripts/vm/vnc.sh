#!/usr/bin/env bash
# Open the dev VM's VNC desktop in macOS's built-in viewer.
# Lima forwards :5901 → 127.0.0.1:5901 by default.
set -euo pipefail

VM_NAME="${RN_LINUX_VM_NAME:-rn-linux}"

if ! limactl list --quiet 2>/dev/null | grep -qx "${VM_NAME}"; then
  echo "VM '${VM_NAME}' does not exist yet. Run scripts/vm/start.sh first." >&2
  exit 1
fi

state="$(limactl list --json | python3 -c "
import json, sys
for vm in (json.loads(l) for l in sys.stdin if l.strip()):
    if vm.get('name') == '${VM_NAME}':
        print(vm.get('status', 'unknown'))
        break
")"

if [[ "${state}" != "Running" ]]; then
  echo "VM '${VM_NAME}' is ${state}. Starting..." >&2
  scripts/vm/start.sh
fi

echo "▸ opening vnc://127.0.0.1:5901 (password: rnlinux)"
open "vnc://127.0.0.1:5901"
