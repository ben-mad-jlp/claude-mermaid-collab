#!/usr/bin/env bash
#
# ios-install-device.sh — build and install the MermaidCollab iOS app on a
# physical device.
#
# Regenerates the Xcode project from project.yml (never hand-edit the
# .xcodeproj), builds the MermaidCollab scheme against a generic iOS device
# destination — this is a signed build, made possible by project.yml's
# DEVELOPMENT_TEAM + CODE_SIGN_STYLE: Automatic — then resolves the target
# device by name and installs the built .app onto it via devicectl.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
cd ios/MermaidCollab

xcodegen generate

DEVICE_NAME="${DEVICE_NAME:-Ben's iPhone}"
DERIVED="$(mktemp -d)"

# -allowProvisioningUpdates lets Xcode mint a profile for com.mermaidcollab.app.
# Without it a device build fails with "No profiles for 'com.mermaidcollab.app'
# were found ... Automatic signing is disabled and unable to generate a profile",
# because no profile for this bundle id has ever been issued.
xcodebuild -project MermaidCollab.xcodeproj -scheme MermaidCollab \
  -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates build

APP_PATH="$DERIVED/Build/Products/Debug-iphoneos/MermaidCollab.app"

DEVICE_LIST_JSON="$(mktemp)"
xcrun devicectl device list --json-output "$DEVICE_LIST_JSON" >/dev/null

DEVICE_ID="$(node -e '
  const fs = require("node:fs");
  const name = process.argv[1];
  const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const devices = data?.result?.devices ?? [];
  const match = devices.find((d) => d?.deviceProperties?.name === name);
  if (!match) process.exit(1);
  console.log(match.identifier);
' "$DEVICE_NAME" "$DEVICE_LIST_JSON")" || {
  echo "error: no paired device found named \"$DEVICE_NAME\" (set DEVICE_NAME to override)" >&2
  exit 1
}

xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"
