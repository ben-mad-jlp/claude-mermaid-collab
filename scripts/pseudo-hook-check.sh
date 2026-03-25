#!/bin/bash
# pseudo-hook-check.sh
#
# Claude Code PostToolUse hook for the Bash tool.
# Receives the tool input as JSON on stdin.
# If the command was a git commit, calls pseudo-track-commit.sh.
#
# Registered in .claude/settings.json — do not rename or move this file.

INPUT=$(cat)

# Extract the command from the JSON input using python3 (available on macOS/Linux)
COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

# Only act on git commit commands (not git commit --amend checks, git status, etc.)
if echo "$COMMAND" | grep -qE 'git\s+commit\b'; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  bash "$SCRIPT_DIR/pseudo-track-commit.sh"
fi
