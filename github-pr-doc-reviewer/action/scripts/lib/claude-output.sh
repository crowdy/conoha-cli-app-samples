#!/usr/bin/env bash
# Helpers for parsing the claude CLI's output back into the review JSON the
# action expects.

set -euo pipefail

# unwrap_claude_output INPUT_FILE
#
# Read claude CLI output from INPUT_FILE and emit the unwrapped review JSON
# on stdout. Handles two shapes:
#
#   1. `claude -p ... --output-format json` produces an envelope of the form
#      {"type":"result", "subtype":"success", "is_error":false, ..., "result":"<text>"}
#      where the model's text reply lives in `result` as a JSON string.
#   2. Plain JSON (older claude CLIs, the CLAUDE_MOCK fixture path) — passed
#      through as-is.
#
# Then strip optional ```fences the model occasionally adds despite the
# system-prompt rule. Robust against:
#   - leading whitespace before the opening fence
#   - language tag after the opening fence (```json, ```JSON, etc.)
#   - trailing whitespace on the closing fence line
#   - blank lines between the closing fence and end-of-input
#
# The caller decides whether the result is valid JSON via a subsequent
# `jq -e` check.
unwrap_claude_output() {
  local in="$1"
  [ -f "$in" ] || return 1

  local inner
  if jq -e '.result | type == "string"' "$in" >/dev/null 2>&1; then
    inner=$(jq -r '.result' "$in")
  else
    inner=$(cat "$in")
  fi

  printf '%s\n' "$inner" | awk '
    { lines[NR] = $0 }
    END {
      n = NR
      first = 0
      last = 0
      # Find first/last non-blank lines so we can match a fence regardless of
      # surrounding whitespace.
      for (i = 1; i <= n; i++) {
        if (lines[i] !~ /^[[:space:]]*$/) { first = i; break }
      }
      for (i = n; i >= 1; i--) {
        if (lines[i] !~ /^[[:space:]]*$/) { last = i; break }
      }
      open_re  = "^[[:space:]]*```[[:alnum:]]*[[:space:]]*$"
      close_re = "^[[:space:]]*```[[:space:]]*$"
      strip = (first > 0 && last > 0 && first != last \
               && lines[first] ~ open_re \
               && lines[last]  ~ close_re)
      for (i = 1; i <= n; i++) {
        if (strip && (i == first || i == last)) continue
        print lines[i]
      }
    }
  '
}
