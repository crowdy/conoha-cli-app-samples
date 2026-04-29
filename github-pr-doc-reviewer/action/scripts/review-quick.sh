#!/usr/bin/env bash
# Quick mode: run mechanical checks on changed files and update a sticky PR comment.

set -euo pipefail

: "${WORK_DIR:?WORK_DIR not set}"
: "${PR_NUMBER:?PR_NUMBER not set}"
: "${ACTION_PATH:?ACTION_PATH not set}"

# shellcheck source=lib/markdown.sh
source "$ACTION_PATH/scripts/lib/markdown.sh"
# shellcheck source=lib/github.sh
source "$ACTION_PATH/scripts/lib/github.sh"

FINDINGS="$WORK_DIR/findings.jsonl"
: > "$FINDINGS"

while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ -f "$file" ] || continue
  case "$file" in
    *.md|*.markdown)
      check_todo_markers "$file" >> "$FINDINGS"
      check_empty_sections "$file" >> "$FINDINGS"
      check_internal_links "$file" >> "$FINDINGS"
      ;;
    *)
      check_todo_markers "$file" >> "$FINDINGS"
      ;;
  esac
done < "$WORK_DIR/changed.txt"

total=$(wc -l < "$FINDINGS" || echo 0)
errors=$(grep -c '"severity":"error"' "$FINDINGS" || true); errors=${errors:-0}
warnings=$(grep -c '"severity":"warning"' "$FINDINGS" || true); warnings=${warnings:-0}

# Build sticky comment body
BODY="$WORK_DIR/sticky-body.md"
{
  echo "## 📋 Doc Review (quick mode)"
  echo ""
  echo "- Files reviewed: $(wc -l < "$WORK_DIR/changed.txt" | tr -d ' ')"
  echo "- Findings: **$total** ($errors error, $warnings warning)"
  echo ""
  if [ "$total" -gt 0 ]; then
    echo "| Severity | Category | File | Line | Message |"
    echo "|---|---|---|---|---|"
    jq -r '"| " + (.severity|ascii_upcase) + " | " + .category + " | `" + .path + "` | " + ((.line|tostring)) + " | " + .message + " |"' "$FINDINGS"
  else
    echo "✅ All mechanical checks passed."
  fi
  echo ""
  echo "<sub>For deeper semantic review (term consistency, ADR compliance, code/doc drift), add the \`deep-review\` label to this PR.</sub>"
} > "$BODY"

update_sticky_comment "$PR_NUMBER" "$BODY"
