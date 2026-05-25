#!/usr/bin/env bash
# Launch the playground on the VM's VNC display in a way that survives the
# limactl shell session ending. The trick: spawn a subshell that re-execs
# the executable with stdio detached, then immediately exit the parent.
set -euo pipefail

REPO=/workspaces/react-native-linux
EXE="$REPO/apps/playground/linux/build/rn-linux-playground"
BUNDLE="${1:-$REPO/apps/playground/linux/build/assets/index.linux.bundle}"
LOG="${RN_PLAYGROUND_LOG:-/tmp/rn-playground.log}"

# Kill any lingering instance gently first.
pkill -TERM -f rn-linux-playground 2>/dev/null || true
sleep 1
pkill -9 -f rn-linux-playground 2>/dev/null || true
sleep 1

# Truncate the log so we always see the latest run.
: > "$LOG"

# nohup + detach stdin → log → log so the child is fully independent of
# the calling shell.
# GSK_RENDERER=ngl: try the new OpenGL renderer. On VNC/software-only
# rasterization stacks (like this VM) it usually beats the default
# cairo fallback by ~2-3x. Override by exporting RN_GSK_RENDERER.
GSK_RENDERER="${RN_GSK_RENDERER:-ngl}"

nohup env DISPLAY=:1 \
  GSK_RENDERER="$GSK_RENDERER" \
  RN_BUNDLE_URL="file://$BUNDLE" \
  "$EXE" </dev/null >"$LOG" 2>&1 &

# Give the kernel a moment to register the process before we hand back.
sleep 1
pid=$(pgrep -f "$EXE" | head -1 || true)
if [[ -z "$pid" ]]; then
  echo "FAILED to launch playground; log tail:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
echo "✓ playground PID=$pid, log at $LOG"
