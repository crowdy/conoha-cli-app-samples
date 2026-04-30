#!/usr/bin/env bats

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$SCRIPT_DIR/action/scripts/lib/claude-output.sh"
  TMP="$BATS_TEST_TMPDIR/in"
}

# --- Envelope unwrap --------------------------------------------------------

@test "unwrap_claude_output: extracts .result string from CLI envelope" {
  printf '%s' '{"type":"result","subtype":"success","is_error":false,"result":"{\"findings\":[],\"summary\":\"ok\"}"}' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.summary == "ok"' >/dev/null
  echo "$output" | jq -e '.findings | length == 0' >/dev/null
}

@test "unwrap_claude_output: passes through plain JSON without envelope" {
  printf '%s' '{"summary":"plain","findings":[{"path":"a","line":1,"severity":"info","category":"x","message":"m"}]}' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.findings[0].path == "a"' >/dev/null
}

@test "unwrap_claude_output: passes through CLAUDE_MOCK fixture shape" {
  cp "$SCRIPT_DIR/action/scripts/fixtures/claude-mock.json" "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.findings' >/dev/null
}

# --- ```fence stripping ----------------------------------------------------

@test "strip fence with json language tag" {
  printf '%s\n' '```json' '{"findings":[]}' '```' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.findings | length == 0' >/dev/null
}

@test "strip plain fence with no language tag" {
  printf '%s\n' '```' '{"findings":[]}' '```' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.findings' >/dev/null
}

@test "strip fence with leading whitespace before opening fence" {
  printf '   %s\n%s\n%s\n' '```json' '{"findings":[]}' '```' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.findings' >/dev/null
}

@test "strip fence with trailing whitespace on closing fence line" {
  printf '%s\n%s\n%s\n' '```json' '{"findings":[]}' '```   ' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.findings' >/dev/null
}

@test "strip fence with trailing blank line after closing fence" {
  printf '%s\n%s\n%s\n\n\n' '```json' '{"findings":[]}' '```' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.findings' >/dev/null
}

@test "strip fence inside envelope.result" {
  # Envelope.result contains a fenced JSON string — should still parse after unwrap.
  printf '%s' '{"result":"```json\n{\"findings\":[],\"summary\":\"fenced\"}\n```"}' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.summary == "fenced"' >/dev/null
}

@test "leave content unchanged when there is no fence" {
  printf '%s' '{"findings":[],"summary":"no-fence"}' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.summary == "no-fence"' >/dev/null
}

@test "do not strip a stray opening fence with no closing fence" {
  # Garbage in, garbage out — but we should not eat the only fence and leave
  # a half-open chunk. Verify the input passes through unchanged-ish (parse
  # will fail downstream and the action falls back to mechanical-only).
  printf '%s\n%s\n' '```json' '{"findings":' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  # Output should still contain the fence (we did not strip it because the
  # corresponding closing fence is missing).
  echo "$output" | grep -qF '```'
}

# --- Combined: envelope + fence + JSON ------------------------------------

@test "envelope.result containing fenced JSON with leading whitespace strips correctly" {
  printf '%s' '{"result":"   ```json\n{\"findings\":[],\"summary\":\"combo\"}\n```\n\n"}' > "$TMP"
  run unwrap_claude_output "$TMP"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.summary == "combo"' >/dev/null
}
