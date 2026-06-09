#!/usr/bin/env bash
#
# mc-port-handshake.sh — the take-over-or-refuse handshake, shell entry point.
#
# Runs as the systemd `ExecStartPre` for mermaid-collab.service so the unit can
# obey the same canonical :9002 port-ownership protocol that the in-process start
# path (P0, decision 04de0e95) enforces for the Electron supervisor and the
# plugin SessionStart hook. Keeping it as a tiny shell probe lets systemd gate
# the bind BEFORE ExecStart runs, on a box that may have no Electron at all.
#
# Contract (matches the P0 decision):
#   - port free                       → exit 0  (ExecStart proceeds, binds)
#   - a HEALTHY current owner holds it → exit 3  (REFUSE: do not double-bind)
#   - a stale / foreign holder         → TAKE OVER: bounded TERM→timeout→KILL,
#                                        poll until the port frees, then exit 0
#
# "Healthy current owner" = GET /api/health returns 200. Anything bound to the
# port that does NOT answer a 200 health check is treated as stale/foreign and
# reaped. This deliberately avoids depending on the optional identity fields so
# the handshake works even against an older server build.
#
# Env:
#   MC_PORT / PORT   port to guard (default 9002)
#   MC_TERM_WAIT     seconds to wait after SIGTERM before SIGKILL (default 5)
#   MC_FREE_WAIT     seconds to wait for the port to free after reaping (default 8)
set -uo pipefail

PORT="${MC_PORT:-${PORT:-9002}}"
TERM_WAIT="${MC_TERM_WAIT:-5}"
FREE_WAIT="${MC_FREE_WAIT:-8}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

log() { echo "[mc-handshake] $*" >&2; }

# Return the PID(s) listening on $PORT, one per line (empty if none).
port_pids() {
  if command -v ss >/dev/null 2>&1; then
    # ss -ltnp prints e.g.  users:(("mc-server",pid=1234,fd=20))
    ss -ltnpH "sport = :${PORT}" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u
  fi
}

port_in_use() { [ -n "$(port_pids)" ]; }

health_ok() {
  command -v curl >/dev/null 2>&1 || return 1
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" 2>/dev/null)" || return 1
  [ "$code" = "200" ]
}

# ── 1. nobody home → proceed ─────────────────────────────────────────────────
if ! port_in_use; then
  log "port ${PORT} is free — proceeding to bind"
  exit 0
fi

# ── 2. a HEALTHY owner answers → refuse (defer to it) ────────────────────────
if health_ok; then
  log "port ${PORT} held by a healthy mermaid-collab (/api/health 200) — REFUSING to take over"
  exit 3
fi

# ── 3. stale / foreign holder → take over ────────────────────────────────────
log "port ${PORT} held but health check failed — taking over stale/foreign holder"
mapfile -t PIDS < <(port_pids)
if [ "${#PIDS[@]}" -eq 0 ]; then
  log "could not resolve holder PID (no ss/lsof?) — proceeding and letting ExecStart contend"
  exit 0
fi

for pid in "${PIDS[@]}"; do
  log "SIGTERM → pid ${pid}"
  kill -TERM "$pid" 2>/dev/null || true
done

# bounded wait for graceful exit
waited=0
while [ "$waited" -lt "$TERM_WAIT" ] && port_in_use; do
  sleep 1; waited=$((waited + 1))
done

# escalate to KILL for any survivors
if port_in_use; then
  for pid in $(port_pids); do
    log "SIGKILL → pid ${pid} (did not exit within ${TERM_WAIT}s)"
    kill -KILL "$pid" 2>/dev/null || true
  done
fi

# poll until the port is actually free
waited=0
while [ "$waited" -lt "$FREE_WAIT" ] && port_in_use; do
  sleep 1; waited=$((waited + 1))
done

if port_in_use; then
  log "ERROR: port ${PORT} still occupied after take-over attempt — aborting"
  exit 1
fi

log "port ${PORT} freed — proceeding to bind"
exit 0
