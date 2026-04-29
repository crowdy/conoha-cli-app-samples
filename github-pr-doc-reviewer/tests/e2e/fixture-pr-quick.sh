#!/usr/bin/env bash
# Local e2e: simulate quick-mode review against the fixture without GitHub.
# Verifies findings JSON and sticky body construction (skips actual API calls).

set -euo pipefail

cd "$(dirname "$0")/../.."
ACTION_PATH="$(pwd)/action"
FIXTURE_DIR="$(pwd)/examples/specs-fixture"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Pretend everything in the fixture changed
( cd "$FIXTURE_DIR" && find . -type f \( -name '*.md' -o -name '*.yml' \) ) \
  | sed 's|^\./||' > "$WORK_DIR/changed.txt"

# Stub gh + GitHub helpers so we don't hit the API
update_sticky_comment() { echo "[stub] would update sticky for PR=$1, body at $2"; cat "$2"; }
export -f update_sticky_comment

# shellcheck source=../../action/scripts/lib/markdown.sh
source "$ACTION_PATH/scripts/lib/markdown.sh"

FINDINGS="$WORK_DIR/findings.jsonl"
: > "$FINDINGS"

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

echo "=== findings ==="
cat "$FINDINGS"
echo "================"

# Assertions on seeded defects.
# Note: the JSON Line shape is {"path":"...","line":N,...,"category":"...","message":"..."}.
# `path` appears before `category`, so when an assertion ties a category to a
# path token (e.g. "login.md"), the path token must come first in the pattern.
assert_finding() {
  local pattern="$1"
  if ! grep -q "$pattern" "$FINDINGS"; then
    echo "FAIL: expected finding matching: $pattern" >&2
    exit 1
  fi
  echo "OK: $pattern"
}

assert_finding 'login.md.*"category":"todo-marker"'
assert_finding '"category":"empty-section".*Edge Cases'
assert_finding '"category":"broken-internal-link".*i18n.md'

echo "=== quick-mode e2e PASS ==="
