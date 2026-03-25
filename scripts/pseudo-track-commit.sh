#!/bin/bash
# pseudo-track-commit.sh
#
# Writes source files changed in the last commit to .pseudo-needs-update.
# Called by both the git post-commit hook and the Claude Code PostToolUse hook.
#
# Usage: bash scripts/pseudo-track-commit.sh
# Run from the project root.

set -euo pipefail

# Must be in a git repo with at least one commit
git rev-parse --git-dir > /dev/null 2>&1 || exit 0

# Need at least two commits to diff
commit_count=$(git rev-list --count HEAD 2>/dev/null || echo 0)
if [ "$commit_count" -lt 2 ]; then
  exit 0
fi

# Resolve project root (script may be called from anywhere)
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
MANIFEST="$PROJECT_ROOT/.pseudo-needs-update"

# Get files changed in the last commit:
# A = Added, M = Modified, R = Renamed
git diff HEAD~1 HEAD --name-only --diff-filter=AMR 2>/dev/null \
  | grep -E '\.(ts|tsx|js|jsx|mjs|py|go|rs|rb|java|swift|kt|c|cpp|h)$' \
  | grep -v -E '(\.test\.|\.spec\.|__tests__|node_modules|dist/|build/|\.d\.ts$)' \
  >> "$MANIFEST" 2>/dev/null || true

# Dedup and sort in place
if [ -f "$MANIFEST" ] && [ -s "$MANIFEST" ]; then
  sort -u "$MANIFEST" -o "$MANIFEST"
fi
