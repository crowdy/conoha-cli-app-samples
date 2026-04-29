#!/usr/bin/env bash
# GitHub API helpers. Requires gh CLI authenticated via GITHUB_TOKEN.

set -euo pipefail

STICKY_MARKER='<!-- doc-reviewer:sticky -->'

# update_sticky_comment PR_NUMBER BODY_FILE
# Finds the bot's previous sticky comment (by hidden marker) and edits it,
# or creates a new comment if none exists.
update_sticky_comment() {
  local pr="$1"
  local body_file="$2"
  local repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

  # Search for existing sticky comment
  local existing_id
  existing_id=$(gh api "repos/$repo/issues/$pr/comments" --paginate \
    --jq ".[] | select(.body | contains(\"$STICKY_MARKER\")) | .id" \
    | head -n1)

  # Prepend marker so future runs can find this comment
  local body
  body=$(printf '%s\n\n%s' "$STICKY_MARKER" "$(cat "$body_file")")

  if [ -n "$existing_id" ]; then
    gh api "repos/$repo/issues/comments/$existing_id" \
      --method PATCH \
      -f body="$body" >/dev/null
    echo "Updated sticky comment $existing_id"
  else
    gh api "repos/$repo/issues/$pr/comments" \
      --method POST \
      -f body="$body" >/dev/null
    echo "Created sticky comment"
  fi
}
