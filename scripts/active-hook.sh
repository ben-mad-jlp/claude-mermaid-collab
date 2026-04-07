#!/bin/bash
# Active hook: fires on PreToolUse to notify the UI that Claude is working
# Reads session_id from stdin JSON, walks parent chain to find claude PID,
# then POSTs an "active" notification to the collab server.

INPUT=$(cat)
echo "$INPUT" > /tmp/.claude-active-hook-debug
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

if [ -z "$SESSION_ID" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Walk up the parent chain to find the claude process
CLAUDE_PID=""
PID=$PPID
while [ "$PID" != "1" ] && [ -n "$PID" ]; do
  CMD=$(ps -o cmd= -p "$PID" 2>/dev/null)
  if echo "$CMD" | grep -q "^claude"; then
    CLAUDE_PID="$PID"
    break
  fi
  PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
done

# POST notification in background to avoid blocking Claude
if [ -n "$CLAUDE_PID" ]; then
  curl -s -X POST http://localhost:3737/api/session-notify \
    -H "Content-Type: application/json" \
    -d "{\"claudeSessionId\": \"$SESSION_ID\", \"claudePid\": $CLAUDE_PID, \"status\": \"active\"}" \
    > /dev/null 2>&1 &
fi

echo '{"continue": true}'
exit 0
