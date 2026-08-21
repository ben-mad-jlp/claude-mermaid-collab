#!/usr/bin/env bash
#
# ios-build-app.sh — build the MermaidCollab iOS app for the simulator.
#
# Regenerates the Xcode project from project.yml (never hand-edit the .xcodeproj)
# and builds the MermaidCollab scheme against an iOS Simulator destination —
# a generic/platform=iOS destination requires a development team and would fail
# signing since project.yml declares no DEVELOPMENT_TEAM.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
cd ios/MermaidCollab

xcodegen generate

xcodebuild -project MermaidCollab.xcodeproj -scheme MermaidCollab \
  -destination 'platform=iOS Simulator,name=iPhone 16' build
