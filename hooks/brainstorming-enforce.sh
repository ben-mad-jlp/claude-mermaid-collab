#!/bin/bash
# hooks/brainstorming-enforce.sh
# PreToolUse hook for Write/Edit tools
# Blocks edits outside .collab/ during brainstorming phase

set -e

# Parse file_path from TOOL_INPUT
FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // .filePath // empty')

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

# Read phase
PHASE=$(jq -r '.phase' "$STATE_FILE")

if [ "$PHASE" = "implementation" ]; then
    exit 0
fi

# Brainstorming - check if file is in .collab/
COLLAB_DIR=$(dirname "$SESSION_PATH")

case "$FILE_PATH" in
    "$COLLAB_DIR"*)
        exit 0
        ;;
    *)
        echo '{"result":"block","reason":"Cannot edit files outside .collab/ during brainstorming phase","suggestion":"Use /ready-to-implement to transition to implementation phase"}'
        exit 1
        ;;
esac
