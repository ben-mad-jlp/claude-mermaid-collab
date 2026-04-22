#!/usr/bin/env bash
set -euo pipefail

FILE_PATH="${1:-}"
PORT="${COLLAB_API_PORT:-9002}"
BASE_URL="http://localhost:${PORT}"

# Only process files inside .collab/sessions/
if [[ "$FILE_PATH" != *"/.collab/sessions/"* ]]; then
  exit 0
fi

# Parse: .../PROJECT/.collab/sessions/SESSION/TYPE_PLURAL/ID.EXT
# Extract PROJECT (everything before /.collab/)
PROJECT="${FILE_PATH%%/.collab/*}"

# Extract the part after .collab/sessions/
AFTER="${FILE_PATH#*/.collab/sessions/}"
SESSION="${AFTER%%/*}"
AFTER="${AFTER#*/}"
TYPE_PLURAL="${AFTER%%/*}"
FILENAME="${AFTER#*/}"
ID="${FILENAME%%.*}"

# Guard: need at least 3 path segments after sessions/
if [[ -z "$SESSION" || -z "$TYPE_PLURAL" || -z "$ID" || "$TYPE_PLURAL" == "$FILENAME" ]]; then
  exit 0
fi

# Normalize type: diagrams→diagram, documents→document, etc.
TYPE="${TYPE_PLURAL%s}"

# Validate known types
case "$TYPE" in
  diagram|document|snippet|design|spreadsheet|embed) ;;
  *) exit 0 ;;
esac

# URL-encode the project path (spaces → %20, etc.)
PROJECT_ENC="$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe='/'))" "$PROJECT" 2>/dev/null || echo "$PROJECT")"

# Check if artifact already registered
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE_URL}/api/artifact/exists?project=${PROJECT_ENC}&session=${SESSION}&type=${TYPE}&id=${ID}")

if [ "$HTTP_STATUS" = "404" ]; then
  # New artifact — register
  RESULT=$(curl -s -w "\n%{http_code}" -X POST \
    "${BASE_URL}/api/artifact/register?project=${PROJECT_ENC}&session=${SESSION}&type=${TYPE}&id=${ID}")
elif [ "$HTTP_STATUS" = "200" ]; then
  # Existing — notify
  RESULT=$(curl -s -w "\n%{http_code}" -X POST \
    "${BASE_URL}/api/artifact/notify?project=${PROJECT_ENC}&session=${SESSION}&type=${TYPE}&id=${ID}")
else
  echo "notify-artifact: exists check failed (HTTP $HTTP_STATUS)" >&2
  exit 1
fi

HTTP_CODE=$(echo "$RESULT" | tail -1)
BODY=$(echo "$RESULT" | head -1)

if [ "$HTTP_CODE" != "200" ]; then
  echo "notify-artifact: failed (HTTP $HTTP_CODE): $BODY" >&2
  exit 1
fi
