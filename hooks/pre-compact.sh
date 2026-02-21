#!/bin/bash

# Read input JSON from stdin (Claude Code provides this)
INPUT=$(cat)

# Find active collab session in current directory
SESSION_DIR=""
for dir in .collab/*/; do
  if [ -f "${dir}collab-state.json" ]; then
    SESSION_DIR="$dir"
    break
  fi
done

# Exit silently if no session
[ -z "$SESSION_DIR" ] && exit 0

# Read current state
STATE_JSON=$(cat "${SESSION_DIR}collab-state.json")
STATE=$(echo "$STATE_JSON" | jq -r '.state')
CURRENT_ITEM=$(echo "$STATE_JSON" | jq -r '.currentItem // empty')

# Determine active skill from state
case "$STATE" in
  brainstorm*) SKILL="brainstorming" ;;
  rough-draft*) SKILL="rough-draft" ;;
  execute-batch|batch-router|ready-to-implement|bug-review|completeness-review|log-batch-complete) SKILL="executing-plans" ;;
  *) SKILL="collab" ;;
esac

# Write context snapshot
cat > "${SESSION_DIR}context-snapshot.json" << EOF
{
  "version": 1,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "activeSkill": "$SKILL",
  "currentStep": "$STATE",
  "pendingQuestion": null,
  "inProgressItem": $( [ -n "$CURRENT_ITEM" ] && echo "$CURRENT_ITEM" || echo "null" ),
  "recentContext": []
}
EOF

# Update state to mark snapshot exists
jq '.hasSnapshot = true' "${SESSION_DIR}collab-state.json" > tmp.$$ && \
  mv tmp.$$ "${SESSION_DIR}collab-state.json"

exit 0
