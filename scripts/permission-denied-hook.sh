#!/bin/bash
# Permission denied hook: fires on PermissionDenied (user rejects a tool call).
# Flips the session back to "waiting" so the UI clears the permission indicator.
# Does not set retry — denial passes through; Claude can ask again on its own.

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
printf '%s' "$INPUT" > "/tmp/.claude-permission-denied-hook-debug-${SESSION_ID}"

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

PAYLOAD=$(jq -nc \
  --arg sid "$SESSION_ID" \
  --arg project "$PROJECT" \
  --arg session "$SESSION" \
  '{claudeSessionId: $sid, project: $project, session: $session, status: "waiting"}')

curl -s -X POST http://localhost:3737/api/session-notify \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  > /dev/null 2>&1 &

echo '{"continue": true}'
exit 0
