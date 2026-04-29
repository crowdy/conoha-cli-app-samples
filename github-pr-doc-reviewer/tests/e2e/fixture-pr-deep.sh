#!/usr/bin/env bash
# Local e2e: deep mode with CLAUDE_MOCK=1 against the fixture.
# Verifies merged findings (mechanical + AI) include all expected categories.

set -euo pipefail

cd "$(dirname "$0")/../.."
ACTION_PATH="$(pwd)/action"
FIXTURE_DIR="$(pwd)/examples/specs-fixture"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

( cd "$FIXTURE_DIR" && find . -type f \( -name '*.md' -o -name '*.yml' \) ) \
  | sed 's|^\./||' > "$WORK_DIR/changed.txt"

# shellcheck source=../../action/scripts/lib/markdown.sh
source "$ACTION_PATH/scripts/lib/markdown.sh"

FINDINGS="$WORK_DIR/findings.jsonl"
: > "$FINDINGS"

# Mechanical checks
(
  cd "$FIXTURE_DIR"
  while IFS= read -r file; do
    [ -f "$file" ] || continue
    case "$file" in
      *.md|*.markdown)
        check_todo_markers "$file" >> "$FINDINGS"
        check_empty_sections "$file" >> "$FINDINGS"
        check_internal_links "$file" >> "$FINDINGS"
        ;;
    esac
  done < "$WORK_DIR/changed.txt"
)

# AI findings from mock fixture
jq -c '.findings[]' "$ACTION_PATH/scripts/fixtures/claude-mock.json" >> "$FINDINGS"

echo "=== merged findings ==="
cat "$FINDINGS"
echo "======================"

assert_finding() {
  local pattern="$1"
  if ! grep -q "$pattern" "$FINDINGS"; then
    echo "FAIL: expected finding matching: $pattern" >&2
    exit 1
  fi
  echo "OK: $pattern"
}

# Mechanical (carried over from quick)
assert_finding '"category":"todo-marker"'
assert_finding '"category":"empty-section"'
assert_finding '"category":"broken-internal-link"'
# AI (from claude-mock.json)
assert_finding '"category":"glossary-mismatch"'
assert_finding '"category":"adr-violation"'

echo "=== deep-mode e2e PASS ==="
