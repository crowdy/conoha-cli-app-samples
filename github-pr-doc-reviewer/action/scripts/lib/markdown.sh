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

# check_empty_sections FILE
# Emits JSON Lines for headers that have no content before the next header or EOF.
check_empty_sections() {
  local file="$1"
  [ -f "$file" ] || return 0
  awk '
    function emit() {
      if (in_section && !has_content) {
        print header_line "\t" header_text
      }
    }
    /^#+[[:space:]]+/ {
      emit()
      header_line = NR
      header_text = $0
      sub(/^#+[[:space:]]+/, "", header_text)
      in_section = 1
      has_content = 0
      next
    }
    in_section && NF > 0 { has_content = 1 }
    END { emit() }
  ' "$file" | while IFS=$'\t' read -r line text; do
    jq -nc \
      --arg path "$file" \
      --argjson line "$line" \
      --arg msg "Empty section: $text" \
      '{path: $path, line: $line, severity: "warning", category: "empty-section", message: $msg}'
  done
}
