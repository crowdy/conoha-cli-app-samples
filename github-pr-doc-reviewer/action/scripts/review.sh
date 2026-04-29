#!/usr/bin/env bash
# Main dispatcher: routes to review-quick.sh or review-deep.sh based on $MODE.

set -euo pipefail

: "${MODE:=quick}"
: "${PATHS:=**/*.md,**/*.yml,**/*.yaml}"
: "${GLOSSARY_PATH:=glossary.md}"
: "${ADR_PATH:=adr}"
: "${FAIL_ON_ERROR:=false}"
: "${ACTION_PATH:?ACTION_PATH not set}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN not set}"

export GH_TOKEN="$GITHUB_TOKEN"

SCRIPT_DIR="$ACTION_PATH/scripts"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# shellcheck source=lib/markdown.sh
source "$SCRIPT_DIR/lib/markdown.sh"
# shellcheck source=lib/github.sh
source "$SCRIPT_DIR/lib/github.sh"
# shellcheck source=lib/http-link.sh
source "$SCRIPT_DIR/lib/http-link.sh"

# Determine PR number
PR_NUMBER="${PR_NUMBER:-${GITHUB_REF##refs/pull/}}"
PR_NUMBER="${PR_NUMBER%%/*}"
if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "$GITHUB_REF" ]; then
  echo "Could not determine PR number from GITHUB_REF=$GITHUB_REF" >&2
  exit 0
fi

# Determine base ref
BASE_REF="${GITHUB_BASE_REF:-main}"
git fetch --no-tags --depth=50 origin "$BASE_REF" 2>/dev/null || true

# List changed files matching paths globs
mapfile -t ALL_CHANGED < <(git diff --name-only "origin/$BASE_REF...HEAD" 2>/dev/null || git diff --name-only HEAD~1..HEAD)
CHANGED_MATCHED=()
IFS=',' read -ra PATH_GLOBS <<< "$PATHS"
shopt -s globstar nullglob 2>/dev/null || true
for file in "${ALL_CHANGED[@]}"; do
  for glob in "${PATH_GLOBS[@]}"; do
    glob="$(echo "$glob" | xargs)"  # trim
    # shellcheck disable=SC2053
    case "$file" in
      $glob) CHANGED_MATCHED+=("$file"); break ;;
    esac
  done
done

echo "Mode: $MODE"
echo "Changed files matched: ${#CHANGED_MATCHED[@]}"
printf '  %s\n' "${CHANGED_MATCHED[@]}"

export PR_NUMBER WORK_DIR
export -f check_todo_markers check_empty_sections check_internal_links
export -f update_sticky_comment post_review check_external_link 2>/dev/null || true

# Write changed files list
printf '%s\n' "${CHANGED_MATCHED[@]}" > "$WORK_DIR/changed.txt"

case "$MODE" in
  quick)
    bash "$SCRIPT_DIR/review-quick.sh"
    ;;
  deep)
    bash "$SCRIPT_DIR/review-deep.sh"
    ;;
  *)
    echo "Unknown mode: $MODE (expected 'quick' or 'deep')" >&2
    exit 1
    ;;
esac

# Output counts
if [ -s "$WORK_DIR/findings.jsonl" ]; then
  findings_count=$(wc -l < "$WORK_DIR/findings.jsonl" | tr -d ' ')
  errors_count=$(grep -c '"severity":"error"' "$WORK_DIR/findings.jsonl" 2>/dev/null || true)
  errors_count=${errors_count:-0}
else
  findings_count=0
  errors_count=0
fi
echo "findings_count=$findings_count" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "errors_count=$errors_count" >> "${GITHUB_OUTPUT:-/dev/null}"

if [ "$FAIL_ON_ERROR" = "true" ] && [ "$errors_count" -gt 0 ]; then
  echo "Failing due to $errors_count error-severity findings (fail-on-error=true)" >&2
  exit 1
fi
exit 0
