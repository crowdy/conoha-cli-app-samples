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

  # Submit review.
  # GitHub returns 422 ("Line could not be resolved") if any inline comment
  # references a line outside the diff hunk window — e.g. a finding the
  # mechanical scan or AI located in unchanged content of a file that is
  # touched elsewhere by the PR. One bad comment fails the entire review.
  # Surface the actual response body and fall back to a body-only review so
  # the user still sees all findings.
  local n_inline payload err_log
  n_inline=$(echo "$comments_json" | jq 'length')
  err_log="$WORK_DIR/post-review-err.log"

  payload=$(jq -nc \
    --arg body "$body" \
    --argjson comments "$comments_json" \
    '{event: "COMMENT", body: $body, comments: $comments}')

  if printf '%s' "$payload" | gh api "repos/$repo/pulls/$pr/reviews" \
       --method POST --input - >"$err_log" 2>&1; then
    echo "Posted review with $n_inline inline comments"
    return 0
  fi

  echo "WARN: review POST with $n_inline inline comments rejected:" >&2
  cat "$err_log" >&2

  # Consolidate all findings into the body and retry without inline comments.
  local fallback_md
  fallback_md=$(jq -r '
    "- **[" + (.severity|ascii_upcase) + " / " + .category + "]** `" + .path + "`" +
    (if .line and .line > 0 then ":L" + (.line|tostring) else "" end) +
    " — " + .message
  ' "$findings_file" | sed '/^$/d')

  local fallback_body
  fallback_body=$(printf '%s\n\n### Findings\n\n%s\n\n_Inline anchoring failed (likely findings outside the PR diff). All findings consolidated above._' "$body" "$fallback_md")

  payload=$(jq -nc \
    --arg body "$fallback_body" \
    '{event: "COMMENT", body: $body, comments: []}')

  if printf '%s' "$payload" | gh api "repos/$repo/pulls/$pr/reviews" \
       --method POST --input - >"$err_log" 2>&1; then
    echo "Posted body-only review (fallback): $n_inline findings consolidated"
    return 0
  fi

  echo "ERROR: fallback body-only review also failed:" >&2
  cat "$err_log" >&2
  return 1
}
