#!/bin/bash
# Active hook: fires on PreToolUse to notify the UI that Claude is working.
# Reads session_id from stdin JSON, looks up the binding file written by
# register_claude_session, then POSTs a "active" notification to the collab server.

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')

# Validate session id format (UUID-ish) before using as filename component.
sid_valid=0
case "$SESSION_ID" in
  ''|*[!0-9a-fA-F-]*) sid_valid=0 ;;
  *) sid_len=${#SESSION_ID}
     if [ "$sid_len" -ge 8 ] && [ "$sid_len" -le 64 ]; then sid_valid=1; fi ;;
esac

if [ "$sid_valid" != "1" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Per-session debug file so concurrent Claude instances don't clobber each other.
printf '%s' "$INPUT" > "/tmp/.claude-active-hook-debug-${SESSION_ID}"

BINDING_FILE="/tmp/.mermaid-collab-binding-${SESSION_ID}.json"
if [ ! -f "$BINDING_FILE" ]; then
  echo '{"continue": true}'
  exit 0
fi

PROJECT=$(jq -r '.project // empty' "$BINDING_FILE")
SESSION=$(jq -r '.session // empty' "$BINDING_FILE")

if [ -z "$PROJECT" ] || [ -z "$SESSION" ]; then
  echo '{"continue": true}'
  exit 0
fi

NOTIFY_STATUS="active"
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

# On PostToolUse Write/Edit, notify the collab server about artifact file changes
HOOK_EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty')
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ "$HOOK_EVENT" = "PostToolUse" ] && { [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ]; }; then
  if [ -n "$FILE_PATH" ]; then
    bash "${CLAUDE_PLUGIN_ROOT}/scripts/notify-artifact.sh" "$FILE_PATH" \
      >> /tmp/mermaid-collab-notify.log 2>&1 &
  fi
fi

echo '{"continue": true}'
exit 0
