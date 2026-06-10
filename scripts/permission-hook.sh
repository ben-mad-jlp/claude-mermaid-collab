#!/bin/bash
# Permission hook: fires on PreToolUse when Claude needs permission approval.
# Reads session_id from stdin JSON, looks up the binding file written by
# register_claude_session, then POSTs a "permission" notification to the collab server.

INPUT=$(cat)

# Capture the raw payload UNCONDITIONALLY (before any early-exit) so a real
# PermissionRequest reveals exactly which fields it carries. The PermissionRequest
# event payload may OMIT session_id (it documents tool_name/tool_input/permission_mode),
# which is why the old session_id-only lookup silently bailed and left the watching
# card green through a permission prompt.
printf '%s' "$INPUT" > "/tmp/.claude-permission-hook-debug-last" 2>/dev/null

SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Resolve the binding. Prefer session_id when present (PreToolUse etc. carry it);
# otherwise fall back to the newest binding whose project == cwd (the common
# single-session-per-project case) so PermissionRequest — which lacks session_id —
# still resolves.
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
  # Direct glob (NOT `ls`, which can emit colorized paths that break the match);
  # pick the binding whose project == cwd. nullglob-safe via the -f guard.
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
# Use the binding's own claudeSessionId downstream (the payload's may be absent).
SESSION_ID="$CLAUDE_SESSION_ID"
printf '%s' "$INPUT" > "/tmp/.claude-permission-hook-debug-${SESSION_ID}"

NOTIFY_STATUS="permission"
STATUS_FILE="/tmp/.mermaid-collab-notify-${SESSION_ID}.status"
LOCK_FILE="/tmp/.mermaid-collab-notify-${SESSION_ID}.lock"

echo "$NOTIFY_STATUS" > "$STATUS_FILE"

_do_notify() {
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
}

if command -v flock >/dev/null 2>&1; then
  ( flock -n 9 || exit 0; _do_notify ) 9>"$LOCK_FILE" &
elif command -v lockf >/dev/null 2>&1; then
  export SESSION_ID PROJECT SESSION STATUS_FILE NOTIFY_STATUS
  ( lockf -t 0 "$LOCK_FILE" sh -c "$(declare -f _do_notify); _do_notify" ) &
else
  ( _do_notify ) &
fi

echo '{"continue": true}'
exit 0
