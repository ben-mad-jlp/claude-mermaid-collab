#!/usr/bin/env bash
#
# install-linux-headless.sh — zero-Electron headless install of mermaid-collab
# on a Linux box (Linux P1 MVP).
#
# Brings up the bare Bun mc-server under a systemd USER unit on :9002 so the
# orchestrator + worker session layer (tmux/ps/worktrees) can be validated on a
# real Ubuntu machine. NO Electron, NO packaging.
#
# What it does:
#   1. build (or reuse) the compiled Linux sidecar  → dist/mc-server-linux-x64
#   2. stage  binary + handshake under ~/.local/share/mermaid-collab/
#   3. install the systemd user unit                → ~/.config/systemd/user/
#   4. enable-linger (survive logout/reboot) + enable --now the service
#   5. poll /api/health until 200
#
# Usage:
#   bash scripts/install-linux-headless.sh            # build if needed, install, start
#   bash scripts/install-linux-headless.sh --rebuild  # force a fresh sidecar compile
#   bash scripts/install-linux-headless.sh --uninstall # stop + remove unit & staged files
#
# Env overrides:
#   MC_PORT          port (default 9002)
#   HEALTH_TIMEOUT   seconds to wait for the sidecar to answer (default 45)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MC_PORT:-9002}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-45}"

SHARE_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/mermaid-collab"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="mermaid-collab.service"
BIN_SRC="$REPO/dist/mc-server-linux-x64"
BIN_DST="$SHARE_DIR/mc-server"
HANDSHAKE_SRC="$REPO/scripts/mc-port-handshake.sh"
HANDSHAKE_DST="$SHARE_DIR/mc-port-handshake.sh"
UNIT_SRC="$REPO/scripts/systemd/$UNIT_NAME"
UNIT_DST="$UNIT_DIR/$UNIT_NAME"

log()  { echo "[install-headless] $*"; }
die()  { echo "[install-headless] ERROR: $*" >&2; exit 1; }

# ── platform guard ───────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "this installer targets Linux (got $(uname -s)). Cross-compile the binary on macOS with: bun run build:sidecar:linux"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found — this MVP requires systemd (user instance)."

# ── uninstall path ───────────────────────────────────────────────────────────
if [ "${1:-}" = "--uninstall" ]; then
  log "stopping + disabling $UNIT_NAME"
  systemctl --user disable --now "$UNIT_NAME" 2>/dev/null || true
  rm -f "$UNIT_DST"
  systemctl --user daemon-reload 2>/dev/null || true
  rm -rf "$SHARE_DIR"
  log "uninstalled (linger left enabled; disable with: loginctl disable-linger $USER)"
  exit 0
fi

REBUILD=0
[ "${1:-}" = "--rebuild" ] && REBUILD=1

# ── 1. build the Linux sidecar if missing ────────────────────────────────────
if [ "$REBUILD" = 1 ] || [ ! -f "$BIN_SRC" ]; then
  command -v bun >/dev/null 2>&1 || die "bun not found on PATH — needed to compile the sidecar (or copy a prebuilt dist/mc-server-linux-x64 over)."
  log "compiling sidecar → $BIN_SRC"
  ( cd "$REPO" && bun run build:sidecar:linux )
fi
[ -f "$BIN_SRC" ] || die "compiled sidecar missing: $BIN_SRC"

# ── 2. stage binary + handshake ──────────────────────────────────────────────
log "staging into $SHARE_DIR"
mkdir -p "$SHARE_DIR"
install -m 0755 "$BIN_SRC" "$BIN_DST"
install -m 0755 "$HANDSHAKE_SRC" "$HANDSHAKE_DST"

# ── 3. install the systemd user unit ─────────────────────────────────────────
log "installing unit → $UNIT_DST"
mkdir -p "$UNIT_DIR"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"
systemctl --user daemon-reload

# ── 4. linger + enable + start ───────────────────────────────────────────────
# enable-linger lets the user manager (and our service) keep running with no
# interactive login — required to survive reboot on a headless box.
if ! loginctl show-user "$USER" 2>/dev/null | grep -q '^Linger=yes'; then
  log "enabling linger for $USER (survives logout/reboot)"
  loginctl enable-linger "$USER" || log "WARN: enable-linger failed (need privileges?); service won't survive logout"
fi

log "enabling + starting $UNIT_NAME"
systemctl --user enable --now "$UNIT_NAME"

# ── 5. poll health ───────────────────────────────────────────────────────────
log "waiting up to ${HEALTH_TIMEOUT}s for http://127.0.0.1:${PORT}/api/health"
deadline=$((SECONDS + HEALTH_TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null; then
    log "✅ mc-server healthy on :${PORT}"
    log "   logs:   journalctl --user -u $UNIT_NAME -f"
    log "   status: systemctl --user status $UNIT_NAME"
    exit 0
  fi
  sleep 1
done

log "status follows:"; systemctl --user status "$UNIT_NAME" --no-pager || true
die "sidecar did not become healthy within ${HEALTH_TIMEOUT}s (see: journalctl --user -u $UNIT_NAME)"
