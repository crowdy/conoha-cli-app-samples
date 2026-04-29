#!/usr/bin/env bash
# Deep mode: mechanical + Claude-driven semantic analysis. Posts inline PR review.

set -euo pipefail

: "${WORK_DIR:?WORK_DIR not set}"
: "${PR_NUMBER:?PR_NUMBER not set}"
: "${ACTION_PATH:?ACTION_PATH not set}"
: "${GLOSSARY_PATH:=glossary.md}"
: "${ADR_PATH:=adr}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

# shellcheck source=lib/markdown.sh
source "$ACTION_PATH/scripts/lib/markdown.sh"
# shellcheck source=lib/github.sh
source "$ACTION_PATH/scripts/lib/github.sh"

MAX_CONTEXT_BYTES="${MAX_CONTEXT_BYTES:-204800}"  # 200 KB cap
FINDINGS="$WORK_DIR/findings.jsonl"
: > "$FINDINGS"

# 1. Mechanical findings
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ -f "$file" ] || continue
  case "$file" in
    *.md|*.markdown)
      check_todo_markers "$file" >> "$FINDINGS"
      check_empty_sections "$file" >> "$FINDINGS"
      check_internal_links "$file" >> "$FINDINGS"
      ;;
  esac
done < "$WORK_DIR/changed.txt"

# 2. Build context — write each value to its own file so the awk substitution
# can read them via getline (avoids -v backslash interpretation issues with
# multi-line bundles that may legitimately contain backslashes, $1, &, etc.).
CTX_DIR="$WORK_DIR/ctx"
mkdir -p "$CTX_DIR"

PR_TITLE=$(gh pr view "$PR_NUMBER" --json title --jq .title 2>/dev/null || echo "")
printf '%s' "$PR_TITLE" > "$CTX_DIR/pr_title.txt"

# Cap diff at 100 KB to keep prompts within reasonable size.
gh pr diff "$PR_NUMBER" 2>/dev/null | head -c 100000 > "$CTX_DIR/pr_diff.txt" || : > "$CTX_DIR/pr_diff.txt"

if [ -f "$GLOSSARY_PATH" ]; then
  cp "$GLOSSARY_PATH" "$CTX_DIR/glossary.txt"
else
  : > "$CTX_DIR/glossary.txt"
fi

: > "$CTX_DIR/adr_bundle.txt"
if [ -d "$ADR_PATH" ]; then
  for adr in "$ADR_PATH"/*.md; do
    [ -f "$adr" ] || continue
    {
      printf '\n#### %s\n\n```\n' "$adr"
      cat "$adr"
      printf '\n```\n'
    } >> "$CTX_DIR/adr_bundle.txt"
  done
fi

# Sibling files: same directory as each changed file, that aren't themselves changed.
: > "$CTX_DIR/sibling_bundle.txt"
declare -A SEEN_SIBLINGS=()
sibling_break=0
while IFS= read -r file; do
  [ "$sibling_break" = "1" ] && break
  [ -z "$file" ] && continue
  dir=$(dirname "$file")
  [ -d "$dir" ] || continue
  for sib in "$dir"/*; do
    [ -f "$sib" ] || continue
    [ -n "${SEEN_SIBLINGS[$sib]:-}" ] && continue
    if grep -qFx "$sib" "$WORK_DIR/changed.txt"; then
      continue
    fi
    SEEN_SIBLINGS[$sib]=1
    case "$sib" in
      *.md|*.yml|*.yaml|*.feature)
        {
          printf '\n#### %s\n\n```\n' "$sib"
          cat "$sib"
          printf '\n```\n'
        } >> "$CTX_DIR/sibling_bundle.txt"
        ;;
    esac
    bundle_size=$(wc -c < "$CTX_DIR/sibling_bundle.txt" | tr -d ' ')
    if [ "$bundle_size" -gt "$MAX_CONTEXT_BYTES" ]; then
      sibling_break=1
      break
    fi
  done
done < "$WORK_DIR/changed.txt"

# 3. Build user prompt.
# Single-line scalars (REPO, PR_NUMBER, PR_TITLE) are substituted by sed with
# a delimiter that won't appear in their values (\x01).
# Multi-line / arbitrary-content values are substituted by awk using getline
# from files + index/substr literal replacement to avoid any backslash or
# regex-replacement special-character interpretation.
PROMPT_TEMPLATE="$ACTION_PATH/scripts/prompts/deep-review.md"
USER_PROMPT="$WORK_DIR/user-prompt.md"

# Stage 1: sed for short scalar fields. PR_TITLE may contain arbitrary chars
# but is single-line; we strip newlines defensively. We use a control-char
# delimiter (\x01) and escape any backslashes / delimiter chars in the value.
sed_escape() {
  # Escape backslash, ampersand, and the chosen delimiter for sed replacement.
  printf '%s' "$1" | tr -d '\n\r' | sed -e 's/[\\&\x01]/\\&/g'
}
SAFE_REPO=$(sed_escape "$GITHUB_REPOSITORY")
SAFE_PR_NUMBER=$(sed_escape "$PR_NUMBER")
SAFE_PR_TITLE=$(sed_escape "$PR_TITLE")

sed \
  -e $'s\x01{{REPO}}\x01'"$SAFE_REPO"$'\x01g' \
  -e $'s\x01{{PR_NUMBER}}\x01'"$SAFE_PR_NUMBER"$'\x01g' \
  -e $'s\x01{{PR_TITLE}}\x01'"$SAFE_PR_TITLE"$'\x01g' \
  "$PROMPT_TEMPLATE" > "$USER_PROMPT.tmp"

# Stage 2: awk substitutes multi-line bundles via getline + literal
# index/substr replacement (no gsub, no -v) to safely preserve backslashes,
# $&, $1 etc. that may appear in diff/code content.
awk -v diff_file="$CTX_DIR/pr_diff.txt" \
    -v gloss_file="$CTX_DIR/glossary.txt" \
    -v adr_file="$CTX_DIR/adr_bundle.txt" \
    -v sib_file="$CTX_DIR/sibling_bundle.txt" '
  function slurp(path,    s, line, first) {
    s = ""; first = 1
    while ((getline line < path) > 0) {
      if (first) { s = line; first = 0 }
      else       { s = s "\n" line }
    }
    close(path)
    return s
  }
  function lit_replace(s, marker, value,    p, mlen) {
    mlen = length(marker)
    while ((p = index(s, marker)) > 0) {
      s = substr(s, 1, p - 1) value substr(s, p + mlen)
    }
    return s
  }
  BEGIN {
    diff  = slurp(diff_file)
    gloss = slurp(gloss_file)
    adr   = slurp(adr_file)
    sib   = slurp(sib_file)
  }
  {
    line = $0
    line = lit_replace(line, "{{PR_DIFF}}",        diff)
    line = lit_replace(line, "{{GLOSSARY}}",       gloss)
    line = lit_replace(line, "{{ADR_BUNDLE}}",     adr)
    line = lit_replace(line, "{{SIBLING_BUNDLE}}", sib)
    print line
  }
' "$USER_PROMPT.tmp" > "$USER_PROMPT"
rm -f "$USER_PROMPT.tmp"

# 4. Call Claude (or use mock).
CLAUDE_OUT="$WORK_DIR/claude.json"
AI_OK=1
SUMMARY=""

if [ "${CLAUDE_MOCK:-0}" = "1" ]; then
  cp "$ACTION_PATH/scripts/fixtures/claude-mock.json" "$CLAUDE_OUT"
  echo "Using CLAUDE_MOCK fixture"
elif ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found — install in runner image" >&2
  SUMMARY="Doc reviewer not configured: claude CLI missing on runner."
  AI_OK=0
elif [ ! -f "$HOME/.claude/.credentials.json" ] && [ ! -f "$HOME/.claude/credentials.json" ] && [ ! -d "$HOME/.config/claude" ]; then
  echo "claude not authenticated — run docker exec -it <container> claude" >&2
  SUMMARY="Doc reviewer not configured: Claude OAuth credentials missing."
  AI_OK=0
else
  claude_invoke() {
    claude -p "$(cat "$USER_PROMPT")" \
      --append-system-prompt "$(cat "$ACTION_PATH/scripts/prompts/system.md")" \
      --output-format json
  }
  if claude_invoke > "$CLAUDE_OUT" 2> "$WORK_DIR/claude-stderr.log"; then
    AI_OK=1
  else
    sleep 2
    if claude_invoke > "$CLAUDE_OUT" 2>> "$WORK_DIR/claude-stderr.log"; then
      AI_OK=1
    else
      AI_OK=0
      SUMMARY="AI analysis failed after retry. See action logs for stderr."
    fi
  fi
fi

# 5. Parse Claude response.
if [ "$AI_OK" = "1" ] && [ -s "$CLAUDE_OUT" ]; then
  if jq -e '.findings' "$CLAUDE_OUT" >/dev/null 2>&1; then
    SUMMARY=$(jq -r '.summary // ""' "$CLAUDE_OUT")
    jq -c '.findings[]' "$CLAUDE_OUT" >> "$FINDINGS"
  else
    SUMMARY="AI response was not valid JSON. Mechanical findings only."
  fi
fi

# 6. Deduplicate (path+line+category). Always emit JSONL (one finding per line).
DEDUPED="$WORK_DIR/findings-dedup.jsonl"
if [ -s "$FINDINGS" ]; then
  if jq -s -c 'unique_by([.path, .line, .category]) | .[]' "$FINDINGS" > "$DEDUPED" 2>/dev/null; then
    mv "$DEDUPED" "$FINDINGS"
  else
    echo "Dedup failed; keeping raw findings" >&2
    rm -f "$DEDUPED"
  fi
fi

# 7. Post review.
post_review "$PR_NUMBER" "$FINDINGS" "${SUMMARY:-Doc review complete.}"
