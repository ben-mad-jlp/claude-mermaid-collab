#!/bin/bash
# SessionStart hook: writes Claude session_id to a PID-keyed temp file
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$SESSION_ID" ]; then
  PID=$PPID
  while [ "$PID" != "1" ] && [ -n "$PID" ] && [ "$PID" != "0" ]; do
    CMD=$(ps -o command= -p "$PID" 2>/dev/null || true)
    if echo "$CMD" | grep -qE "(^|/)claude( |$)"; then
      echo "$SESSION_ID" > "/tmp/.claude-session-id-$PID" 2>/dev/null
      break
    fi
    PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ' || true)
  done
fi
echo '{"continue": true}'
exit 0
