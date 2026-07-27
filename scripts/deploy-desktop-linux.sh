#!/usr/bin/env bash
#
# deploy-desktop-linux.sh — one-command LOCAL install of the desktop app on Ubuntu.
#
# The Linux analogue of scripts/deploy-desktop.sh (macOS). Where deploy-desktop.sh
# hot-swaps artifacts into an installed .app, and release-linux.ts builds+PUBLISHES
# distributable packages to an apt repo / update feed for OTHER boxes, THIS script
# does the missing middle: rebuild and reinstall the desktop .deb on THIS machine.
#
# The desktop app is a MENU-LAUNCHED, PER-USER GUI: this script installs it
# system-wide (registering the .desktop menu entry) but does NOT launch it — each
# user starts "Mermaid Collab" from their own application menu, and the app then
# spawns its own self-owned sidecar (mc-server, MC_BROWSER_TARGET=electron-view)
# and connects on first launch. A running old instance keeps running until the
# user restarts it; pass --kill-running to terminate stale instances so the next
# menu launch picks up the new version.
#
# Recipe:
#   1. build the desktop .deb           (cd desktop && npm run dist → desktop/dist/*.deb)
#      (optionally the mermaid-collab-server .deb too, with --with-server)
#   2. install via dpkg -i (apt -f fallback for deps) — needs sudo
#   3. (optional) --kill-running: stop stale running instances
#   4. verify: installed pkg version == repo version, launcher + .desktop entry present
#
# Usage:
#   bash scripts/deploy-desktop-linux.sh                  # build + install
#   bash scripts/deploy-desktop-linux.sh --no-build       # install already-built .deb
#   bash scripts/deploy-desktop-linux.sh --with-server    # also rebuild+install the server .deb
#   bash scripts/deploy-desktop-linux.sh --kill-running   # also kill stale running instances
#
# Env overrides:
#   MC_PORT   sidecar health port used by --kill-running   (default: 9002)
#   APP_BIN   installed launcher                           (default: /opt/Mermaid Collab/mermaid-collab-desktop)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MC_PORT:-9002}"
APP_BIN="${APP_BIN:-/opt/Mermaid Collab/mermaid-collab-desktop}"
DESKTOP_ENTRY="/usr/share/applications/mermaid-collab-desktop.desktop"
DO_BUILD=1
KILL_RUNNING=0
WITH_SERVER=0
for arg in "$@"; do
  case "$arg" in
    --no-build)     DO_BUILD=0 ;;
    --kill-running) KILL_RUNNING=1 ;;
    --with-server)  WITH_SERVER=1 ;;
    -h|--help)      sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m[deploy-linux]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy-linux] WARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy-linux] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
VERSION="$(node -p "require('$REPO/package.json').version" 2>/dev/null)" || die "cannot read repo version"

# ── 1. build ──────────────────────────────────────────────────────────────────
if [ "$DO_BUILD" = 1 ]; then
  log "1/4 building desktop .deb (npm run dist) — v$VERSION…"
  # electron-builder expands linux.publish's ${env.MC_UPDATE_FEED_URL} at config-parse
  # time and hard-fails when it's unset — even for a purely local build. Give it a
  # harmless placeholder (we never actually publish here) so packaging proceeds.
  ( cd "$REPO/desktop" && MC_UPDATE_FEED_URL="${MC_UPDATE_FEED_URL:-http://localhost/none}" npm run dist )
  if [ "$WITH_SERVER" = 1 ]; then
    log "     building mermaid-collab-server .deb…"
    ( cd "$REPO" && bun run build:deb:server )
  fi
else
  log "1/4 --no-build: using existing artifacts"
fi

# ── 2. locate + install ───────────────────────────────────────────────────────
newest_deb() { ls -t "$1"/*.deb 2>/dev/null | head -1; }
DESKTOP_DEB="$(ls -t "$REPO"/desktop/dist/mermaid-collab-desktop_"$VERSION"_*.deb 2>/dev/null | head -1)"
[ -z "$DESKTOP_DEB" ] && DESKTOP_DEB="$(newest_deb "$REPO/desktop/dist")"
[ -f "$DESKTOP_DEB" ] || die "no desktop .deb found in $REPO/desktop/dist (build first, or drop --no-build)"

DEBS=("$DESKTOP_DEB")
if [ "$WITH_SERVER" = 1 ]; then
  SERVER_DEB="$(ls -t "$REPO"/dist/mermaid-collab-server_"$VERSION"_*.deb 2>/dev/null | head -1)"
  [ -z "$SERVER_DEB" ] && SERVER_DEB="$(newest_deb "$REPO/dist")"
  [ -f "$SERVER_DEB" ] && DEBS=("$SERVER_DEB" "$DESKTOP_DEB") || warn "no server .deb found — installing desktop only"
fi

log "2/4 installing: ${DEBS[*]}"
if ! ${SUDO} dpkg -i "${DEBS[@]}"; then
  log "     dpkg reported unmet deps — running apt-get -f install…"
  ${SUDO} apt-get -f install -y
fi

INSTALLED="$(dpkg-query -W -f='${Version}' mermaid-collab-desktop 2>/dev/null || echo '?')"
[ "$INSTALLED" = "$VERSION" ] || die "installed desktop version ($INSTALLED) != repo version ($VERSION) — install did not take"
log "     installed mermaid-collab-desktop $INSTALLED"

# ── 3. (optional) kill stale running instances ────────────────────────────────
# Match ONLY processes whose executable is the installed launcher — pgrep on the
# exact path, then kill by pid. A broad `pkill -f mermaid-collab-desktop` is a
# footgun: it also matches this script's own command line and would kill the deploy.
if [ "$KILL_RUNNING" = 1 ]; then
  log "3/4 --kill-running: stopping stale instances so the next menu launch is fresh…"
  APP_PIDS="$(${SUDO} pgrep -f "$APP_BIN" 2>/dev/null || true)"
  if [ -n "$APP_PIDS" ]; then
    ${SUDO} kill -9 $APP_PIDS 2>/dev/null || true
    log "     killed: $APP_PIDS"
  else
    log "     none running"
  fi
else
  log "3/4 leaving any running instances alone (pass --kill-running to restart them)"
fi

# ── 4. verify install ─────────────────────────────────────────────────────────
[ -x "$APP_BIN" ]       || die "installed launcher missing/not executable: $APP_BIN"
[ -f "$DESKTOP_ENTRY" ] || die "menu entry missing: $DESKTOP_ENTRY (app won't appear in the launcher)"
log "4/4 verified launcher + menu entry present"
printf '\033[1;32m[deploy-linux] DONE\033[0m — desktop %s installed system-wide.\n' "$INSTALLED"
log "Each user launches \"Mermaid Collab\" from their application menu; it spawns its own sidecar and connects on first launch."
