#!/usr/bin/env bash
#
# deploy-desktop.sh — one-command deploy of the local build into the installed
# Mermaid Collab.app (realizes the d0d59599 deploy-script todo).
#
# Does the whole recipe that was previously hand-run:
#   1. build the sidecar (mc-server) + the UI bundle (vite)
#   2. back up the app's current mc-server + ui/dist (timestamped .bak-<ts>)
#   3. swap the freshly-built artifacts in (ditto)
#   4. FORCE-restart the app so a fresh sidecar respawns on the freed port
#      — the sidecar is detached and survives a plain quit/kill, and `open`
#        right after a soft kill races into a sidecar-less app, so we pkill -9
#        the whole app, confirm the port is free, THEN relaunch by full path
#      — retries the relaunch once if the sidecar doesn't come up
#   5. poll /health until 200 and verify the served UI bundle matches the dist
#
# Usage:
#   bash scripts/deploy-desktop.sh            # full build + deploy
#   bash scripts/deploy-desktop.sh --no-build # deploy the already-built artifacts
#
# Env overrides:
#   APP_PATH   default "/Applications/Mermaid Collab.app"
#   MC_PORT    default 9002
#   HEALTH_TIMEOUT  seconds to wait for the sidecar (default 45)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${APP_PATH:-/Applications/Mermaid Collab.app}"
RES="$APP_PATH/Contents/Resources"
PORT="${MC_PORT:-9002}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-45}"
DO_BUILD=1
HOT_SWAP=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    # Phase-2 (49e3c1f6): after swapping the binary, ask Electron main to restart
    # ONLY the sidecar child (app window survives) instead of pkill+relaunch.
    # Falls back to the full relaunch if the control call fails.
    --hot-swap) HOT_SWAP=1 ;;
  esac
done

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$APP_PATH" ] || die "app not found at: $APP_PATH (set APP_PATH=...)"
[ -d "$RES/ui/dist" ] || die "app Resources/ui/dist missing — is this the right app bundle?"

port_pid() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1; }
app_running() { pgrep -f "$APP_PATH/Contents/MacOS" >/dev/null 2>&1; }

# Settle/kill loop: a detached/source-spawned sidecar (bun run src/server.ts from
# the plugin cache, or the app's own detached mc-server) can survive the app kill
# and keep re-grabbing the port. Rather than wait-then-die, actively kill whatever
# holds the port — TERM then KILL — until it's free or we give up.
free_port() {
  local tries="${1:-20}" pid
  for _ in $(seq 1 "$tries"); do
    pid="$(port_pid)"
    [ -z "$pid" ] && return 0
    kill "$pid" 2>/dev/null || true
    # Also sweep stray sidecars by name so a respawn can't immediately re-bind.
    pkill -f "bun run src/server.ts" 2>/dev/null || true
    pkill -f "Resources/mc-server" 2>/dev/null || true
    sleep 0.5
    pid="$(port_pid)"
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
    sleep 0.5
  done
  [ -z "$(port_pid)" ]
}

# ── 1. build ────────────────────────────────────────────────────────────────
if [ "$DO_BUILD" = 1 ]; then
  log "building sidecar (mc-server)…"
  ( cd "$REPO/desktop" && bun run build:sidecar )
  log "building UI bundle (vite)…"
  ( cd "$REPO/ui" && bunx vite build )
else
  log "--no-build: deploying existing artifacts"
fi

SIDECAR_SRC="$REPO/desktop/resources/mc-server"
UI_SRC="$REPO/ui/dist"
[ -f "$SIDECAR_SRC" ] || die "built sidecar missing: $SIDECAR_SRC"
[ -f "$UI_SRC/index.html" ] || die "built UI missing: $UI_SRC/index.html"

# ── 2 & 3. backup + swap ─────────────────────────────────────────────────────
TS="$(date +%s)"
log "backing up current artifacts (.bak-$TS) and swapping in the new build…"
cp "$RES/mc-server" "$RES/mc-server.bak-$TS"
mv "$RES/ui/dist" "$RES/ui/dist.bak-$TS"
ditto "$SIDECAR_SRC" "$RES/mc-server"
ditto "$UI_SRC" "$RES/ui/dist"
# ffmpeg/ffprobe bundled next to mc-server (build:sidecar copies them into desktop/resources)
# — the sprite video tools need them; the compiled sidecar resolves via MERMAID_RESOURCES_PATH.
for bin in ffmpeg ffprobe; do
  if [ -f "$REPO/desktop/resources/$bin" ]; then
    ditto "$REPO/desktop/resources/$bin" "$RES/$bin"
    chmod +x "$RES/$bin" 2>/dev/null || true
    log "bundled $bin into app Resources"
  else
    log "WARNING: $REPO/desktop/resources/$bin missing — sprite video tools will 501"
  fi
done
log "swapped (rollback: restore mc-server.bak-$TS / ui/dist.bak-$TS)"

# ── 4. force-restart ─────────────────────────────────────────────────────────
restart() {
  log "force-quitting the app (so the detached sidecar dies and the port frees)…"
  pkill -9 -f "Mermaid Collab" 2>/dev/null || true
  # Wait for the app's own processes to exit.
  for _ in $(seq 1 15); do app_running || break; sleep 1; done
  app_running && die "app processes did not exit"
  # Then settle/kill anything still squatting the port (a respawned/source-spawned
  # sidecar that survives the app kill and keeps re-grabbing it).
  if [ -n "$(port_pid)" ]; then
    log "port $PORT still held (PID $(port_pid)) — killing the squatting sidecar…"
    free_port 20 || die "port $PORT still held by PID $(port_pid) after settle/kill"
  fi
  log "relaunching by full path…"
  open "$APP_PATH"
}

wait_health() {
  local t=0
  until [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/" 2>/dev/null)" = "200" ]; do
    sleep 2; t=$((t+2))
    [ "$t" -ge "$HEALTH_TIMEOUT" ] && return 1
  done
  return 0
}

# Phase-2 hot-swap: ask Electron main to restart only the sidecar child. Returns
# 0 on a healthy swap, non-zero to trigger the full-relaunch fallback.
hot_swap() {
  [ "$HOT_SWAP" = "1" ] || return 1
  [ -n "${MC_DESKTOP_CONTROL_URL:-}" ] && [ -n "${MC_DESKTOP_CONTROL_TOKEN:-}" ] || {
    log "hot-swap requested but no desktop-control URL/token in env — falling back"; return 1; }
  log "hot-swapping the sidecar via Electron main (window stays up)…"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "authorization: Bearer $MC_DESKTOP_CONTROL_TOKEN" \
    "$MC_DESKTOP_CONTROL_URL/sidecar/hot-swap" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] || { log "hot-swap returned $code — falling back to full relaunch"; return 1; }
  return 0
}

if hot_swap; then
  log "waiting for the swapped sidecar on :$PORT (up to ${HEALTH_TIMEOUT}s)…"
  wait_health || die "swapped sidecar never reached health 200 on :$PORT"
else
  restart
  log "waiting for the sidecar on :$PORT (up to ${HEALTH_TIMEOUT}s)…"
  if ! wait_health; then
    log "sidecar didn't come up — retrying restart once…"
    restart
    wait_health || die "sidecar never reached health 200 on :$PORT after retry"
  fi
fi

# ── 5. verify ────────────────────────────────────────────────────────────────
SIDECAR_PID="$(port_pid)"
SERVED="$(curl -s "http://localhost:$PORT/" 2>/dev/null | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)"
if [ -n "$SERVED" ] && [ -f "$RES/ui/dist/assets/$SERVED" ]; then
  UI_OK="UI bundle $SERVED matches deployed dist"
else
  UI_OK="WARNING: served bundle '$SERVED' not found in deployed dist"
fi

printf '\033[1;32m[deploy] DONE\033[0m — sidecar PID %s on :%s, health 200\n' "${SIDECAR_PID:-?}" "$PORT"
log "$UI_OK"
log "backups: $RES/mc-server.bak-$TS , $RES/ui/dist.bak-$TS"
