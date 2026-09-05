#!/bin/sh
# Starts code-server (VS Code in the browser) bound to localhost only. Optional: if code-server
# is not installed this script exits quietly and the app runs without the editor pane.
set -eu

PORT="${CODE_SERVER_PORT:-7682}"
WORKSPACE="${KP2_WORKSPACE:-$PWD}"
# Short path on purpose: code-server's IPC socket lives here and Unix socket paths are length-limited.
DATA_DIR="${KP2_CODE_SERVER_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/kp2/code-server}"

if ! command -v code-server >/dev/null 2>&1; then
  echo "code-server not found; editor pane disabled (macOS: brew install code-server)."
  exit 0
fi

mkdir -p "$DATA_DIR"
echo "code-server: 127.0.0.1:$PORT -> $WORKSPACE (data: $DATA_DIR)"
# --auth none is safe only because we bind to 127.0.0.1.
exec code-server \
  --auth none \
  --bind-addr "127.0.0.1:$PORT" \
  --user-data-dir "$DATA_DIR" \
  --disable-telemetry \
  --disable-update-check \
  --disable-workspace-trust \
  --disable-getting-started-override \
  "$WORKSPACE"
