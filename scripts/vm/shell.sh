#!/usr/bin/env bash
# Drop into a shell inside the dev VM, with cwd set to the mounted repo.
set -euo pipefail

VM_NAME="${RN_LINUX_VM_NAME:-rn-linux}"

exec limactl shell --workdir "/workspaces/react-native-linux" "${VM_NAME}" "$@"
