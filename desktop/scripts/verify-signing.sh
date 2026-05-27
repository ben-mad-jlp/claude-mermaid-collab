#!/usr/bin/env bash
# Verify a built macOS app is correctly signed, notarized, and stapled.
#
# Usage:
#   ./scripts/verify-signing.sh                       # auto-detects dist/mac-*/Mermaid Collab.app
#   ./scripts/verify-signing.sh "path/to/Some.app"    # explicit app path
#
# Exit code is non-zero if any check fails, so it's CI-friendly.
set -uo pipefail

EXPECTED_TEAM="${APPLE_TEAM_ID:-N8N4CQ6RT3}"

# ---- locate the .app ---------------------------------------------------------
APP="${1:-}"
if [[ -z "$APP" ]]; then
  # Prefer arm64, then x64, then a universal/unspecified dir.
  for d in dist/mac-arm64 dist/mac-x64 dist/mac dist/mac-universal; do
    if [[ -d "$d" ]]; then
      APP=$(/bin/ls -d "$d"/*.app 2>/dev/null | head -1)
      [[ -n "$APP" ]] && break
    fi
  done
fi

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "✗ No .app found. Pass a path, or run 'npm run dist' first." >&2
  echo "  Looked under: dist/mac-arm64, dist/mac-x64, dist/mac, dist/mac-universal" >&2
  exit 1
fi

echo "Verifying: $APP"
echo "Expected Team ID: $EXPECTED_TEAM"
echo

FAIL=0
step() { echo "── $1 ──"; }
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAIL=1; }

# ---- 1. signature validity --------------------------------------------------
step "codesign --verify (deep, strict)"
if codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | sed 's/^/  /'; then
  pass "signature valid"
else
  fail "signature verification failed"
fi
echo

# ---- 2. Developer ID authority + team ---------------------------------------
step "codesign authority / TeamIdentifier"
CS_INFO=$(codesign -dvvv "$APP" 2>&1)
echo "$CS_INFO" | grep -E "Authority=|TeamIdentifier=" | sed 's/^/  /'
if echo "$CS_INFO" | grep -q "Authority=Developer ID Application"; then
  pass "signed with Developer ID Application"
else
  fail "not signed with a Developer ID Application cert"
fi
if echo "$CS_INFO" | grep -q "TeamIdentifier=$EXPECTED_TEAM"; then
  pass "team is $EXPECTED_TEAM"
else
  fail "team is not $EXPECTED_TEAM (see above)"
fi
echo

# ---- 3. Gatekeeper assessment (notarization) --------------------------------
step "spctl --assess (Gatekeeper)"
SPCTL_OUT=$(spctl -a -vvv -t install "$APP" 2>&1)
echo "$SPCTL_OUT" | sed 's/^/  /'
if echo "$SPCTL_OUT" | grep -qi "source=Notarized Developer ID"; then
  pass "accepted — Notarized Developer ID"
elif echo "$SPCTL_OUT" | grep -qi "accepted"; then
  fail "accepted but NOT notarized (source is not 'Notarized Developer ID')"
else
  fail "Gatekeeper rejected the app"
fi
echo

# ---- 4. stapled notarization ticket -----------------------------------------
step "stapler validate"
if xcrun stapler validate "$APP" 2>&1 | sed 's/^/  /'; then
  pass "notarization ticket is stapled"
else
  fail "no stapled ticket (online check may still pass, but offline launch will Gatekeeper-prompt)"
fi
echo

# ---- 5. the Bun sidecar must be signed too ----------------------------------
step "sidecar (mc-server) signature"
SIDECAR="$APP/Contents/Resources/mc-server"
if [[ -f "$SIDECAR" ]]; then
  if codesign --verify --verbose "$SIDECAR" 2>&1 | sed 's/^/  /'; then
    pass "mc-server is signed"
  else
    fail "mc-server is NOT signed (notarization would have rejected this)"
  fi
else
  fail "mc-server not found at Contents/Resources/mc-server"
fi
echo

# ---- summary ----------------------------------------------------------------
if [[ "$FAIL" -eq 0 ]]; then
  echo "✅ All checks passed — app is signed, notarized, and stapled."
else
  echo "❌ One or more checks failed (see ✗ above)."
fi
exit "$FAIL"
