#!/bin/bash
# hooks/post-task-complete.sh
# Updates task graph and logs completion

set -e

TASK_ID="$COMPLETED_TASK_ID"

# Find session
find_session_path() {
    if [ -n "$COLLAB_SESSION_PATH" ]; then
        echo "$COLLAB_SESSION_PATH"
        return
    fi

    local current="$PWD"
    while [ "$current" != "/" ]; do
        if [ -d "$current/.collab" ]; then
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
[ -z "$SESSION_PATH" ] && exit 0

STATE_FILE="$SESSION_PATH/collab-state.json"
[ ! -f "$STATE_FILE" ] && exit 0

# Read state
STATE=$(cat "$STATE_FILE")

# Find task name
TASK_NAME=$(echo "$STATE" | jq -r --arg id "$TASK_ID" '.tasks[] | select(.id == $id) | .name')

# Add to completion log
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
STATE=$(echo "$STATE" | jq --arg id "$TASK_ID" --arg ts "$TIMESTAMP" \
    '.completionLog += [{"task": $id, "completedAt": $ts}]')

# Update lastAction
STATE=$(echo "$STATE" | jq --arg ts "$TIMESTAMP" --arg name "$TASK_NAME" \
    '.lastAction = {"type": "task_complete", "details": ("Completed: " + $name), "timestamp": $ts}')

STATE=$(echo "$STATE" | jq --arg ts "$TIMESTAMP" '.lastUpdated = $ts')

# Write state
echo "$STATE" > "$STATE_FILE"

# Output notification
COMPLETE=$(echo "$STATE" | jq '[.tasks[] | select(.status == "complete")] | length')
TOTAL=$(echo "$STATE" | jq '.tasks | length')
echo "Task $TASK_ID ($TASK_NAME) complete. $COMPLETE/$TOTAL tasks done."

exit 0
