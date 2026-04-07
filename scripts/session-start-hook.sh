#!/bin/bash
# SessionStart hook: writes Claude session_id to a PID-keyed temp file
# Debug: log the full parent chain to find the right PID
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [ -n "$SESSION_ID" ]; then
  # Log debug info
  echo "hook_pid=$$, ppid=$PPID" > /tmp/.claude-hook-debug
  # Walk up the parent chain to find the claude process
  PID=$PPID
  while [ "$PID" != "1" ] && [ -n "$PID" ]; do
    CMD=$(ps -o cmd= -p "$PID" 2>/dev/null)
    echo "pid=$PID cmd=$CMD" >> /tmp/.claude-hook-debug
    if echo "$CMD" | grep -q "^claude"; then
      echo "$SESSION_ID" > "/tmp/.claude-session-id-$PID"
      echo "wrote to /tmp/.claude-session-id-$PID" >> /tmp/.claude-hook-debug
      break
    fi
    PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')
  done
fi
echo '{"continue": true}'
