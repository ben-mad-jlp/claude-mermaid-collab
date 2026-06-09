#!/usr/bin/env bash
#
# publish-apt-repo.sh — publish the built .deb packages into a signed apt repo
# (reprepro) so target boxes get updates via plain `apt update && apt upgrade`.
#
# This is the .deb half of the Linux P4 update mechanism (the AppImage half is
# electron-updater self-update; see docs/LINUX-RELEASE.md). It is the PRIMARY
# update path — the apt repo serves both mermaid-collab-server (headless) and
# mermaid-collab-desktop (Electron GUI) packages.
#
# What it does:
#   1. preconditions: Linux + reprepro + a GPG signing key
#   2. initialise the repo tree (conf/distributions) on first run
#   3. `reprepro includedeb` every *.deb found under the dist dirs
#   4. export the signing key as <repo>/mermaid-collab-archive-keyring.gpg
#   5. print the install one-liner for a fresh box
#
# Usage:
#   bash scripts/publish-apt-repo.sh                 # publish dist/*.deb + desktop/dist/*.deb
#   APT_REPO_DIR=/srv/apt bash scripts/publish-apt-repo.sh
#
# Env overrides:
#   APT_REPO_DIR   repo root to publish into (default ./dist/apt-repo)
#   APT_CODENAME   suite codename (default "stable")
#   APT_SIGN_KEY   GPG key id/email to SignWith (default: first secret key)
#   APT_BASE_URL   public URL the repo will be served at (for the install hint;
#                  default http://localhost/apt)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APT_REPO_DIR="${APT_REPO_DIR:-$REPO/dist/apt-repo}"
APT_CODENAME="${APT_CODENAME:-stable}"
APT_BASE_URL="${APT_BASE_URL:-http://localhost/apt}"

log() { echo "[publish-apt] $*"; }
die() { echo "[publish-apt] ERROR: $*" >&2; exit 1; }

# ── 1. preconditions ─────────────────────────────────────────────────────────
[ "$(uname -s)" = "Linux" ] || die "apt repo publishing requires Linux/reprepro (got $(uname -s)). Run on the Linux release box / CI."
command -v reprepro >/dev/null 2>&1 || die "reprepro not found — install it:  sudo apt install reprepro"
command -v gpg >/dev/null 2>&1 || die "gpg not found — needed to sign the repo (Release.gpg / InRelease)."

# Resolve the signing key: explicit env, else the first available secret key.
SIGN_KEY="${APT_SIGN_KEY:-}"
if [ -z "$SIGN_KEY" ]; then
  SIGN_KEY="$(gpg --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^sec:/{print $5; exit}')"
fi
[ -n "$SIGN_KEY" ] || die "no GPG signing key found. Generate one (gpg --full-generate-key) or set APT_SIGN_KEY=<id>."
log "signing with GPG key: $SIGN_KEY"

# ── 2. initialise the repo tree ──────────────────────────────────────────────
mkdir -p "$APT_REPO_DIR/conf"
sed -e "s/__CODENAME__/$APT_CODENAME/" -e "s/__SIGNKEY__/$SIGN_KEY/" \
  "$REPO/scripts/apt-repo/distributions.tmpl" > "$APT_REPO_DIR/conf/distributions"
log "wrote $APT_REPO_DIR/conf/distributions (codename=$APT_CODENAME)"

# ── 3. include every built .deb ──────────────────────────────────────────────
shopt -s nullglob
DEBS=( "$REPO"/dist/*.deb "$REPO"/desktop/dist/*.deb )
[ "${#DEBS[@]}" -gt 0 ] || die "no .deb files found under dist/ or desktop/dist/. Build them first (bun run release:linux)."

for deb in "${DEBS[@]}"; do
  log "includedeb $APT_CODENAME ← $(basename "$deb")"
  # reprepro rejects a re-include of the same version; ignore that specific case
  # so a re-run after a partial publish is idempotent.
  if ! reprepro -b "$APT_REPO_DIR" includedeb "$APT_CODENAME" "$deb" 2>/tmp/reprepro.err; then
    if grep -qi "already registered" /tmp/reprepro.err; then
      log "  (already registered at this version — skipping)"
    else
      cat /tmp/reprepro.err >&2
      die "reprepro includedeb failed for $(basename "$deb")"
    fi
  fi
done

# ── 4. export the public signing key for clients ─────────────────────────────
KEYRING="$APT_REPO_DIR/mermaid-collab-archive-keyring.gpg"
gpg --export "$SIGN_KEY" > "$KEYRING"
log "exported public signing key → $KEYRING"

# ── 5. install one-liner ─────────────────────────────────────────────────────
log "published to $APT_REPO_DIR"
cat <<EOF

  Serve $APT_REPO_DIR at $APT_BASE_URL, then on a target box:

    curl -fsSL $APT_BASE_URL/mermaid-collab-archive-keyring.gpg \\
      | sudo tee /usr/share/keyrings/mermaid-collab-archive-keyring.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/mermaid-collab-archive-keyring.gpg] $APT_BASE_URL $APT_CODENAME main" \\
      | sudo tee /etc/apt/sources.list.d/mermaid-collab.list
    sudo apt update && sudo apt install mermaid-collab-server   # or mermaid-collab-desktop

  Thereafter updates arrive via:  sudo apt update && sudo apt upgrade
EOF
