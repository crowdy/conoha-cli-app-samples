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

# post_review PR_NUMBER FINDINGS_JSONL SUMMARY_TEXT
# Posts a PR review with inline comments where line is known, and a
# summary body with general findings. Always uses event=COMMENT.
post_review() {
  local pr="$1"
  local findings_file="$2"
  local summary="$3"
  local repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

  # Build inline comments array from findings with line >= 1
  local comments_json
  comments_json=$(jq -s '
    [ .[] | select(.line != null and .line > 0) |
      { path: .path,
        line: .line,
        side: "RIGHT",
        body: ("**[" + (.severity|ascii_upcase) + " / " + .category + "]** " + .message)
      }
    ]
  ' "$findings_file")

  # General findings (no line) go into the body
  local general_md
  general_md=$(jq -r '
    select(.line == null or .line <= 0) |
    "- **[" + (.severity|ascii_upcase) + " / " + .category + "]** `" + .path + "`: " + .message
  ' "$findings_file" | sed '/^$/d')

  local body
  body=$(printf '## Doc Review (deep mode)\n\n%s\n' "$summary")
  if [ -n "$general_md" ]; then
    body=$(printf '%s\n\n### General findings\n\n%s\n' "$body" "$general_md")
  fi

  # Submit review
  local payload
  payload=$(jq -nc \
    --arg body "$body" \
    --argjson comments "$comments_json" \
    '{event: "COMMENT", body: $body, comments: $comments}')

  printf '%s' "$payload" | gh api "repos/$repo/pulls/$pr/reviews" \
    --method POST --input - >/dev/null
  echo "Posted review with $(echo "$comments_json" | jq 'length') inline comments"
}
