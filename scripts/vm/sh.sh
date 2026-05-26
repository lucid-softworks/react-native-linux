#!/usr/bin/env bash
# Run a command inside the dev VM with cwd pinned to the repo mount,
# so paths align between macOS host and Linux guest.
#
# Why this exists:
# `limactl shell <vm> -- bash -c '…'` inherits the host's cwd. When
# the caller invokes from `/Users/luna/code/…` (the macOS path), the
# guest tries to `cd` into that path — which doesn't exist inside the
# VM — and spams two `bash: cd: … No such file or directory` lines
# before each command runs. Passing `--workdir /workspaces/...` (or
# any directory that exists in the guest) suppresses the cd attempt
# entirely.
#
# Usage:
#   scripts/vm/sh.sh 'echo hi; uname -a'
#   scripts/vm/sh.sh 'cmake --build apps/playground/linux/build'
#   scripts/vm/sh.sh 'DISPLAY=:1 import -window root /tmp/x.png'
#
# Anything you'd type after `bash -c` goes in a single quoted arg.

set -euo pipefail

VM_NAME="${RN_LINUX_VM_NAME:-rn-linux}"
WORKDIR="${RN_LINUX_WORKDIR:-/workspaces/react-native-linux}"

if [[ $# -eq 0 ]]; then
  echo "usage: $0 '<command>'" >&2
  exit 2
fi

exec limactl shell --workdir "${WORKDIR}" "${VM_NAME}" bash -lc "$*"
