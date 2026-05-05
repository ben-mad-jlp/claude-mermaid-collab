#!/bin/bash
# Read JSON that Claude Code pipes to stdin
input=$(cat)

# Extract fields with fallbacks
PCT=$(echo "$input"     | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)

# Walk up the process tree to find the real Claude CLI PID (same logic as session-start-hook.sh).
# $PPID alone can be an intermediate shell, not the Claude process itself.
_find_claude_pid() {
  local pid=$PPID
  while [ "$pid" != "1" ] && [ -n "$pid" ] && [ "$pid" != "0" ]; do
    local cmd
    cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
    if echo "$cmd" | grep -qE "(^|/)claude( |$)"; then
      echo "$pid"
      return
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
  done
}
CLAUDE_PID=$(_find_claude_pid)
if [ -z "$CLAUDE_PID" ]; then
  CLAUDE_PID=$PPID
fi

curl -s --connect-timeout 2 --max-time 3 -X POST http://localhost:9002/api/session/context-update \
  -H 'Content-Type: application/json' \
  -d "{\"claudePid\":$CLAUDE_PID,\"contextPercent\":$PCT}" \
  >/dev/null 2>&1 &
COST=$(echo "$input"    | jq -r '.cost.total_cost_usd // 0')
FIVE_H=$(echo "$input"  | jq -r '.rate_limits.five_hour.used_percentage // 0' | cut -d. -f1)
SEVEN_D=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // 0' | cut -d. -f1)
MODEL=$(echo "$input" | jq -r '.model.display_name // ""')

# Format cost to 2 decimal places
COST_FMT=$(printf "%.2f" "$COST")

# ANSI color codes
RESET="\033[0m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"

# Color a percentage: green <50, yellow 50-79, red >=80
color_pct() {
  local pct=$1
  if   [ "$pct" -ge 80 ]; then printf "${RED}%s%%${RESET}" "$pct"
  elif [ "$pct" -ge 50 ]; then printf "${YELLOW}%s%%${RESET}" "$pct"
  else                         printf "${GREEN}%s%%${RESET}" "$pct"
  fi
}

# Color a cost: green <$1, yellow $1-$5, red >=$5
color_cost() {
  local cost=$1
  # bash can't do float compare, so use awk
  local tier=$(awk -v c="$cost" 'BEGIN { if (c >= 5) print "red"; else if (c >= 1) print "yellow"; else print "green" }')
  case "$tier" in
    red)    printf "${RED}\$%s${RESET}" "$cost" ;;
    yellow) printf "${YELLOW}\$%s${RESET}" "$cost" ;;
    *)      printf "${GREEN}\$%s${RESET}" "$cost" ;;
  esac
}

# Output one line
MODEL_LABEL=${MODEL:+" | $MODEL"}
printf '%b\n' "🧠 $(color_pct $PCT) ctx | 💰 $(color_cost $COST_FMT) | ⏱  5h:$(color_pct $FIVE_H) 7d:$(color_pct $SEVEN_D)${MODEL_LABEL}"
