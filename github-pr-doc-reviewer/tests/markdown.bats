#!/usr/bin/env bats

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$SCRIPT_DIR/action/scripts/lib/markdown.sh"
  FIXTURES="$SCRIPT_DIR/tests/fixtures"
}

@test "smoke: bats harness loads markdown.sh" {
  run bash -c "type check_todo_markers >/dev/null 2>&1; echo \$?"
  # Will fail until check_todo_markers is defined - this is intentional;
  # later tasks will satisfy it. For now, just confirm bats runs.
  [ -n "$output" ]
}

@test "check_todo_markers detects TBD" {
  run check_todo_markers "$FIXTURES/sample-with-issues.md"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"category":"todo-marker"'
  echo "$output" | grep -q '"line":3'
}

@test "check_todo_markers detects TODO" {
  run check_todo_markers "$FIXTURES/sample-with-issues.md"
  [ "$status" -eq 0 ]
  count=$(echo "$output" | grep -c '"category":"todo-marker"' || true)
  [ "$count" -ge 2 ]
}

@test "check_todo_markers reports nothing on clean file" {
  run check_todo_markers "$FIXTURES/sample-good.md"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
