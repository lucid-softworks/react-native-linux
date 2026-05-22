#!/usr/bin/env bash
# Gracefully stop the dev VM. Disk image persists; next `start.sh` is fast.
set -euo pipefail

VM_NAME="${RN_LINUX_VM_NAME:-rn-linux}"
limactl stop "${VM_NAME}"
