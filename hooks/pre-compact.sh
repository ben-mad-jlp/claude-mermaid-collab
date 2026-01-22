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
STATE=$(cat "${SESSION_DIR}collab-state.json")
PHASE=$(echo "$STATE" | jq -r '.phase')
CURRENT_ITEM=$(echo "$STATE" | jq -r '.currentItem // empty')

# Determine active skill from phase
case "$PHASE" in
  brainstorming*) SKILL="brainstorming" ;;
  rough-draft*) SKILL="rough-draft" ;;
  implementation*) SKILL="executing-plans" ;;
  *) SKILL="collab" ;;
esac

# Write context snapshot
cat > "${SESSION_DIR}context-snapshot.json" << EOF
{
  "version": 1,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "activeSkill": "$SKILL",
  "currentStep": "$PHASE",
  "pendingQuestion": null,
  "inProgressItem": $( [ -n "$CURRENT_ITEM" ] && echo "$CURRENT_ITEM" || echo "null" ),
  "recentContext": []
}
EOF

# Update state to mark snapshot exists
jq '.hasSnapshot = true' "${SESSION_DIR}collab-state.json" > tmp.$$ && \
  mv tmp.$$ "${SESSION_DIR}collab-state.json"

exit 0
