#!/bin/bash
# hooks/brainstorming-enforce.sh
# PreToolUse hook for Write/Edit tools
# Blocks edits outside .collab/ during brainstorming phase

set -e

# Read JSON input from stdin (Claude Code hook input format)
INPUT=$(cat)

# Parse file_path from tool_input field
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [ -z "$FILE_PATH" ]; then
    # Can't determine file, allow
    exit 0
fi

# Find session path
find_session_path() {
    if [ -n "$COLLAB_SESSION_PATH" ]; then
        echo "$COLLAB_SESSION_PATH"
        return
    fi

    # Scan for .collab/
    local current="$PWD"
    while [ "$current" != "/" ]; do
        if [ -d "$current/.collab" ]; then
            # Find most recent session
            local latest=$(ls -t "$current/.collab" 2>/dev/null | head -1)
            if [ -n "$latest" ]; then
                echo "$current/.collab/$latest"
                return
            fi
        fi
        current=$(dirname "$current")
    done
}

SESSION_PATH=$(find_session_path)

if [ -z "$SESSION_PATH" ]; then
    # No session, allow all
    exit 0
fi

STATE_FILE="$SESSION_PATH/collab-state.json"

if [ ! -f "$STATE_FILE" ]; then
    exit 0
fi

# Read state
STATE=$(jq -r '.state' "$STATE_FILE")

# Allow edits during implementation states
case "$STATE" in
    execute-batch|batch-router|log-batch-complete|ready-to-implement|bug-review|completeness-review)
        exit 0
        ;;
esac

# Brainstorming - check if file is in .collab/
COLLAB_DIR=$(dirname "$SESSION_PATH")

case "$FILE_PATH" in
    "$COLLAB_DIR"*)
        exit 0
        ;;
    *)
        # Exit 2 = blocking error, stderr is shown to user
        echo "Cannot edit files outside .collab/ during brainstorming phase. Use /ready-to-implement to transition to implementation phase." >&2
        exit 2
        ;;
esac
