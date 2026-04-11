#!/bin/bash
# SessionStart hook: writes Claude session_id to a PID-keyed temp file.
# On clear/compact, carries forward any existing binding from the old session id
# to the new session id. Also prunes stale PID-keyed session id files and
# old binding files.

DEBUG_LOG="/tmp/.claude-session-start-hook-debug"

INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
SOURCE=$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null)

# Validate session id format (UUID-ish) before using it in file paths.
sid_valid=0
case "$SESSION_ID" in
  ''|*[!0-9a-fA-F-]*) sid_valid=0 ;;
  *) sid_len=${#SESSION_ID}
     if [ "$sid_len" -ge 8 ] && [ "$sid_len" -le 64 ]; then sid_valid=1; fi ;;
esac

SID_FILE=""
if [ "$sid_valid" = "1" ]; then
  # Walk up the process tree to find the Claude CLI PID.
  PID=$PPID
  CLAUDE_PID=""
  while [ "$PID" != "1" ] && [ -n "$PID" ] && [ "$PID" != "0" ]; do
    CMD=$(ps -o command= -p "$PID" 2>/dev/null || true)
    if echo "$CMD" | grep -qE "(^|/)claude( |$)"; then
      CLAUDE_PID="$PID"
      break
    fi
    PID=$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ' || true)
  done

  if [ -n "$CLAUDE_PID" ]; then
    SID_FILE="/tmp/.claude-session-id-$CLAUDE_PID"

    # Read previous session id (if any) before overwriting — head -n1 + trim trailing newline.
    OLD_SID=""
    if [ -f "$SID_FILE" ]; then
      OLD_SID=$(head -n1 "$SID_FILE" 2>/dev/null | tr -d '\r\n ')
    fi

    # Validate OLD_SID format too.
    old_sid_valid=0
    case "$OLD_SID" in
      ''|*[!0-9a-fA-F-]*) old_sid_valid=0 ;;
      *) old_len=${#OLD_SID}
         if [ "$old_len" -ge 8 ] && [ "$old_len" -le 64 ]; then old_sid_valid=1; fi ;;
    esac

    # Write the new session id for this Claude PID.
    echo "$SESSION_ID" > "$SID_FILE" 2>/dev/null

    # Carry forward binding on clear/compact.
    if { [ "$SOURCE" = "clear" ] || [ "$SOURCE" = "compact" ]; } \
       && [ "$old_sid_valid" = "1" ] && [ "$OLD_SID" != "$SESSION_ID" ]; then
      OLD_BINDING="/tmp/.mermaid-collab-binding-$OLD_SID.json"
      NEW_BINDING="/tmp/.mermaid-collab-binding-$SESSION_ID.json"
      if [ -f "$OLD_BINDING" ]; then
        if jq --arg sid "$SESSION_ID" '.claudeSessionId = $sid' "$OLD_BINDING" > "$NEW_BINDING" 2>/dev/null; then
          rm -f "$OLD_BINDING"
        else
          rm -f "$NEW_BINDING"
          printf '[%s] jq carry-forward failed: %s -> %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$OLD_BINDING" "$NEW_BINDING" >> "$DEBUG_LOG"
        fi
      fi
    fi
  fi
fi

# Determine current user id portably.
CURRENT_UID=$(id -u 2>/dev/null || echo "")

# stat command differs between Mac (BSD) and Linux (GNU). Try BSD first, fall back to GNU.
file_owner() {
  stat -f %u "$1" 2>/dev/null || stat -c %u "$1" 2>/dev/null || echo ""
}

# Cleanup: prune stale /tmp/.claude-session-id-* files whose PID is no longer a live claude process.
for f in /tmp/.claude-session-id-*; do
  [ -e "$f" ] || continue
  # Never delete the file we just wrote.
  [ -n "$SID_FILE" ] && [ "$f" = "$SID_FILE" ] && continue
  # Skip files not owned by the current user.
  if [ -n "$CURRENT_UID" ]; then
    owner=$(file_owner "$f")
    if [ -z "$owner" ] || [ "$owner" != "$CURRENT_UID" ]; then
      continue
    fi
  fi
  base=$(basename "$f")
  stale_pid="${base#.claude-session-id-}"
  case "$stale_pid" in
    ''|*[!0-9]*)
      rm -f "$f"
      continue
      ;;
  esac
  stale_cmd=$(ps -o command= -p "$stale_pid" 2>/dev/null || true)
  if [ -z "$stale_cmd" ] || ! echo "$stale_cmd" | grep -qE "(^|/)claude( |$)"; then
    rm -f "$f"
  fi
done

# Prune old binding files (older than 7 days), owned by current user only.
for b in /tmp/.mermaid-collab-binding-*.json; do
  [ -e "$b" ] || continue
  if [ -n "$CURRENT_UID" ]; then
    owner=$(file_owner "$b")
    if [ -z "$owner" ] || [ "$owner" != "$CURRENT_UID" ]; then
      continue
    fi
  fi
  # Portable age check: find -mtime +7
  if find "$b" -maxdepth 0 -mtime +7 2>/dev/null | grep -q .; then
    rm -f "$b"
  fi
done

echo '{"continue": true}'
exit 0
