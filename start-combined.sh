#!/usr/bin/env bash
# Launch the combined collab server (UI + API + WS same-origin) on a single port.
# Same-origin is REQUIRED for the streamed browser panel: its screencast/input
# WebSocket cannot survive a dev-server proxy hop (Vite proxy throws EPIPE under
# the binary frame load). This serves ui/dist directly from server.ts.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-9102}"
BIND="${MERMAID_BIND_HOST:-0.0.0.0}"

# Server-owned headless Chrome for the in-UI streamed browser.
CHROME_PATH="$(ls -d /home/qbintelligence/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1)"

# Auth token (required when binding beyond loopback). Read from file if present.
TOKEN_FILE=".mermaid-auth-token"
TOKEN="${MERMAID_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(cat "$TOKEN_FILE")"
fi

echo "Starting combined collab server: ${BIND}:${PORT} (streamed-panel, chrome=${CHROME_PATH})"

exec env \
  PORT="$PORT" \
  MERMAID_BIND_HOST="$BIND" \
  MC_BROWSER_TARGET=streamed-panel \
  MERMAID_CHROME_PATH="$CHROME_PATH" \
  MERMAID_AUTH_TOKEN="$TOKEN" \
  bun run src/server.ts
