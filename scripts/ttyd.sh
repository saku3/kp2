#!/bin/sh
# Starts ttyd bound to localhost only. The browser UI connects through the Vite proxy.
set -eu

PORT="${TTYD_PORT:-7681}"

if [ -n "${SHELL:-}" ] && [ -x "$SHELL" ]; then
  RUN_SHELL="$SHELL"
elif [ -x /bin/zsh ]; then
  RUN_SHELL=/bin/zsh
else
  RUN_SHELL=/bin/bash
fi

if ! command -v ttyd >/dev/null 2>&1; then
  echo "ttyd not found. Install it first (macOS: brew install ttyd)." >&2
  exit 1
fi

echo "ttyd: 127.0.0.1:$PORT -> $RUN_SHELL"
# -i 127.0.0.1 : bind to localhost only
# -W           : allow client input (ttyd >= 1.7 is read-only by default)
exec ttyd -i 127.0.0.1 -p "$PORT" -W "$RUN_SHELL" -l
