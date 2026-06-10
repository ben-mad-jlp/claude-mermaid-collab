#!/bin/bash
# hooks/server-check.sh - Ensures the mermaid-collab server is running
#
# Claude Code PreToolUse hook for mcp__mermaid__* tools.
#
# The desktop UI app is the CANONICAL server when installed: launch it rather
# than spinning a competing `bun run src/server.ts` source server, which would
# seize port 9002 and shadow the app (the two racing for the port was a real
# source of churn — see the unified-project-list work). Only when no app is
# installed do we fall back to the source server so plain plugin users still work.

set -e

PORT=${MERMAID_PORT:-9002}
APP_PATH="${MERMAID_APP_PATH:-/Applications/Mermaid Collab.app}"
MAX_WAIT=12  # seconds (stay under the 15s hook timeout in hooks.json)
POLL_INTERVAL=0.5

# Get the project root (parent of hooks/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

check_server() {
  curl --silent --fail --max-time 1 "http://localhost:$PORT/api/health" > /dev/null 2>&1
}

# Open a path/URL with the platform's launcher (macOS `open`, Linux `xdg-open`).
open_native() {
  if command -v open > /dev/null 2>&1; then
    open "$1" > /dev/null 2>&1 || true
  elif command -v xdg-open > /dev/null 2>&1; then
    xdg-open "$1" > /dev/null 2>&1 || true
  fi
}

wait_for_server() {
  local elapsed=0
  while [ "$elapsed" -lt "$MAX_WAIT" ]; do
    if check_server; then
      echo "Server ready on port $PORT" >&2
      exit 0
    fi
    sleep $POLL_INTERVAL
    elapsed=$((elapsed + 1))
  done
}

# If a server is already running, we're done — defer to whatever owns the port
# (normally the canonical desktop app).
if check_server; then
  exit 0
fi

# Prefer the canonical desktop UI app when it's installed.
if [ -d "$APP_PATH" ]; then
  echo "Launching the canonical Mermaid Collab app…" >&2
  open_native "$APP_PATH"
  wait_for_server
  # The app launched but its sidecar didn't answer in time. Do NOT fall back to a
  # source server — that reintroduces the port race the canonical-app rule exists
  # to prevent. Surface a clear blocker instead.
  echo "ERROR: Mermaid Collab app did not come up on port $PORT within ${MAX_WAIT}s" >&2
  echo "Open the app manually, or set MERMAID_APP_PATH if it lives elsewhere." >&2
  exit 2
fi

# No desktop app installed — fall back to the source server (plain plugin user).
# Re-probe immediately before spawning: if ANYTHING already holds :9002 (a server
# that came up between the top-of-script check and now), do NOT spawn a competitor
# that would shadow it. The hook is never a canonical owner — it may only spawn
# when the port is genuinely free (design-ubuntu-native §4d).
if check_server; then
  exit 0
fi
echo "No desktop app found; starting mermaid-collab server from source…" >&2
cd "$PROJECT_ROOT" && bun run src/server.ts > /dev/null 2>&1 &

wait_for_server

echo "ERROR: mermaid-collab server failed to start within ${MAX_WAIT}s" >&2
echo "Check logs or try manually: cd $PROJECT_ROOT && bun run src/server.ts" >&2
exit 2
