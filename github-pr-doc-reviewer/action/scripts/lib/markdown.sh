#!/usr/bin/env bash
# Mechanical markdown checks. Each function emits JSON Lines on stdout.

set -euo pipefail

# check_todo_markers FILE
# Emits JSON Lines for each TBD/TODO/FIXME/??? marker.
check_todo_markers() {
  local file="$1"
  [ -f "$file" ] || return 0
  { grep -nE '\b(TBD|TODO|FIXME)\b|\?\?\?' "$file" 2>/dev/null || true; } | while IFS=: read -r line content; do
    local trimmed
    trimmed=$(printf '%s' "$content" | sed -E 's/^[[:space:]]+//' | cut -c1-80)
    jq -nc \
      --arg path "$file" \
      --argjson line "$line" \
      --arg msg "Marker found: $trimmed" \
      '{path: $path, line: $line, severity: "warning", category: "todo-marker", message: $msg}'
  done
}
