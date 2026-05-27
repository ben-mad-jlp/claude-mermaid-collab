#!/usr/bin/env bash
# Fast debug-launch of the Electron desktop app for AI/dev inspection.
#
# Rebuilds the main/preload/renderer bundles, kills any running instance, then
# launches the built app directly via `electron .` (NO packaging/signing step —
# this is the fast loop) with a FIXED CDP port + the Node inspector exposed, and
# tees logs to a file. Pair with scripts/app-debug.ts to screenshot / eval / read
# console against the running app.
#
# Usage:
#   ./scripts/debug-app.sh            # rebuild + launch
#   ./scripts/debug-app.sh --no-build # relaunch without rebuilding
#
# Env (overridable):
#   MC_CDP_PORT  renderer CDP port            (default 9223 — clear of Chrome's 9333)
#   MC_INSPECT   Node main-process inspector  (default 9229)
#   MC_LOG       log file                     (default /tmp/mc-app.log)
set -uo pipefail
cd "$(dirname "$0")/.."   # → desktop/

MC_CDP_PORT="${MC_CDP_PORT:-9223}"
MC_INSPECT="${MC_INSPECT:-9229}"
MC_LOG="${MC_LOG:-/tmp/mc-app.log}"

if [[ "${1:-}" != "--no-build" ]]; then
  echo "▶ building main/preload/renderer…"
  npm run build >/dev/null 2>&1 || { echo "✗ build failed — run 'npm run build' to see errors"; exit 1; }
fi

echo "▶ stopping any running instance…"
# All windows of this app (packaged or `electron .`) share this user-data-dir;
# matching it reliably catches every helper + the launcher, freeing the
# single-instance lock so the relaunch isn't bounced.
pkill -f "mermaid-collab-desktop" 2>/dev/null
pkill -f "Resources/mc-server" 2>/dev/null
# The main process is `Electron .` (capital E) with NO user-data-dir in its args,
# so the patterns above only catch helpers. Match the dev Electron binary directly
# (case-sensitive) to free the single-instance lock + the CDP port.
pkill -f "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" 2>/dev/null
sleep 1.5

echo "▶ launching (CDP :$MC_CDP_PORT, inspector :$MC_INSPECT)…"
: > "$MC_LOG"
MC_CDP_PORT="$MC_CDP_PORT" MC_INSPECT="$MC_INSPECT" npx electron . >"$MC_LOG" 2>&1 &
APP_PID=$!

# Wait for the renderer CDP endpoint to come up.
for _ in $(seq 1 30); do
  if curl -s -m 1 "http://127.0.0.1:$MC_CDP_PORT/json/version" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo
echo "✅ app launched (pid $APP_PID)"
echo "   CDP targets : http://127.0.0.1:$MC_CDP_PORT/json/list"
echo "   inspector   : chrome://inspect  (or ws on :$MC_INSPECT) for the main process"
echo "   logs        : $MC_LOG"
echo
echo "Drive it:"
echo "   bun scripts/app-debug.ts targets"
echo "   bun scripts/app-debug.ts shot                 # screenshot the app UI"
echo "   bun scripts/app-debug.ts eval 'document.title'"
echo "   bun scripts/app-debug.ts console --ms 4000"
