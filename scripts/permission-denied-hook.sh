#!/bin/bash
# Permission denied hook: fires on PermissionDenied (user rejects a tool call).
# Flips the session back to "waiting" so the UI clears the permission indicator.
# Does not set retry — denial passes through; Claude can ask again on its own.

INPUT=$(cat)
# Capture the raw payload unconditionally (PermissionDenied, like PermissionRequest,
# may omit session_id — see permission-hook.sh).
printf '%s' "$INPUT" > "/tmp/.claude-permission-denied-hook-debug-last" 2>/dev/null

SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Resolve binding by session_id, else by project==cwd (PermissionDenied lacks session_id).
sid_valid=0
case "$SESSION_ID" in
  ''|*[!0-9a-fA-F-]*) sid_valid=0 ;;
  *) sid_len=${#SESSION_ID}
     if [ "$sid_len" -ge 8 ] && [ "$sid_len" -le 64 ]; then sid_valid=1; fi ;;
esac

BINDING_FILE=""
if [ "$sid_valid" = "1" ] && [ -f "/tmp/.mermaid-collab-binding-${SESSION_ID}.json" ]; then
  BINDING_FILE="/tmp/.mermaid-collab-binding-${SESSION_ID}.json"
elif [ -n "$CWD" ]; then
  for b in /tmp/.mermaid-collab-binding-*.json; do
    [ -f "$b" ] || continue
    if [ "$(jq -r '.project // empty' "$b" 2>/dev/null)" = "$CWD" ]; then BINDING_FILE="$b"; break; fi
  done
fi

if [ -z "$BINDING_FILE" ] || [ ! -f "$BINDING_FILE" ]; then
  echo '{"continue": true}'
  exit 0
fi

PROJECT=$(jq -r '.project // empty' "$BINDING_FILE")
SESSION=$(jq -r '.session // empty' "$BINDING_FILE")
CLAUDE_SESSION_ID=$(jq -r '.claudeSessionId // empty' "$BINDING_FILE")

if [ -z "$PROJECT" ] || [ -z "$SESSION" ] || [ -z "$CLAUDE_SESSION_ID" ]; then
  echo '{"continue": true}'
  exit 0
fi
SESSION_ID="$CLAUDE_SESSION_ID"

NOTIFY_STATUS="permission"
STATUS_FILE="/tmp/.mermaid-collab-notify-${SESSION_ID}.status"
LOCK_FILE="/tmp/.mermaid-collab-notify-${SESSION_ID}.lock"

echo "$NOTIFY_STATUS" > "$STATUS_FILE"

(
  flock -n 9 || exit 0
  sleep 0.2
  FINAL_STATUS=$(cat "$STATUS_FILE" 2>/dev/null || echo "$NOTIFY_STATUS")
  PAYLOAD=$(jq -nc \
    --arg sid "$SESSION_ID" \
    --arg project "$PROJECT" \
    --arg session "$SESSION" \
    --arg status "$FINAL_STATUS" \
    '{claudeSessionId: $sid, project: $project, session: $session, status: $status}')
  curl -s --max-time 3 -X POST http://localhost:9002/api/session-notify \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    > /dev/null 2>&1
) 9>"$LOCK_FILE" &

echo '{"continue": true}'
exit 0
