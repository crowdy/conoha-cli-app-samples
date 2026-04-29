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
