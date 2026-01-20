#!/bin/bash
# hooks/server-check.sh - Ensures mermaid-collab server is running
#
# Claude Code PreToolUse hook for mcp__mermaid__* tools
# Automatically starts the server if not running

set -e

PORT=${MERMAID_PORT:-3737}
MAX_WAIT=10  # seconds
POLL_INTERVAL=0.5

# Get the project root (parent of hooks/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

check_server() {
  curl --silent --fail --max-time 1 "http://localhost:$PORT" > /dev/null 2>&1
}

# If server is already running, we're done
if check_server; then
  exit 0
fi

# Start server in background
echo "Starting mermaid-collab server..." >&2
cd "$PROJECT_ROOT" && bun run src/server.ts > /dev/null 2>&1 &
SERVER_PID=$!

# Wait for server to be ready
elapsed=0
while [ "$elapsed" -lt "$MAX_WAIT" ]; do
  if check_server; then
    echo "Server ready on port $PORT" >&2
    exit 0
  fi
  sleep $POLL_INTERVAL
  elapsed=$((elapsed + 1))
done

# Timeout - server didn't start
echo "ERROR: mermaid-collab server failed to start within ${MAX_WAIT}s" >&2
echo "Check logs or try manually: cd $PROJECT_ROOT && bun run src/server.ts" >&2
exit 1
