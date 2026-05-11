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

# GitHub's review-body length cap is 65,536 characters. Stay safely below it
# in the fallback so the second POST doesn't itself bounce on body size.
# Exposed as a variable so tests can override it.
: "${POST_REVIEW_BODY_MAX:=60000}"

# truncate_to_chars STRING MAX
# Truncate STRING to at most MAX *characters* (not bytes), appending a
# truncation marker so a maintainer reading the review knows findings were
# elided. Pure-bash so we don't add a Python dependency.
truncate_to_chars() {
  local s="$1" max="$2"
  if [ "${#s}" -le "$max" ]; then
    printf '%s' "$s"
    return
  fi
  local marker=$'\n\n_…body truncated; some findings were elided to stay under GitHub\'s review-body limit. See action logs for the full list._'
  if [ "${#marker}" -ge "$max" ]; then
    # Marker alone wouldn't fit — emit a hard truncation without it. This is
    # only reached for absurdly small caps (mostly relevant in tests).
    printf '%s' "${s:0:$max}"
    return
  fi
  local keep=$(( max - ${#marker} ))
  printf '%s%s' "${s:0:$keep}" "$marker"
}

# inline_eligible_lines DIFF_FILE
# Parse a unified=0 diff and emit {path: [lines, ...]} as JSON. The lines are
# the new-side line numbers covered by addition hunks — the only anchors
# GitHub will accept for inline review comments. Files with no addition lines
# (pure deletions, deleted files) are omitted from the map. Empty diff → "{}".
inline_eligible_lines() {
  local diff_file="$1"
  awk '
    /^\+\+\+ / {
      file = $2
      if (file == "/dev/null") { file = ""; next }
      sub(/^b\//, "", file)
      next
    }
    /^@@ / {
      if (file == "") next
      plus = $3
      sub(/^\+/, "", plus)
      n = split(plus, a, ",")
      start = a[1] + 0
      count = (n == 2 ? a[2] + 0 : 1)
      if (count == 0) next
      for (i = 0; i < count; i++) print file "\t" (start + i)
    }
  ' "$diff_file" | jq -R -s '
    split("\n") | map(select(length > 0)) |
    map(split("\t") | {path: .[0], line: (.[1] | tonumber)}) |
    group_by(.path) |
    map({key: .[0].path, value: [.[].line]}) |
    from_entries
  '
}

# post_review PR_NUMBER FINDINGS_JSONL SUMMARY_TEXT
# Posts a PR review with inline comments where line is known, and a
# summary body with general findings. Always uses event=COMMENT.
#
# Inline comments are pre-filtered to lines inside the PR's actual diff
# hunks (GitHub rejects the entire review with 422 if any inline comment
# anchors outside a hunk). Out-of-hunk findings — and findings without a
# line — are consolidated into the review body's General findings list.
# The 422 fallback below remains as defence in depth.
post_review() {
  local pr="$1"
  local findings_file="$2"
  local summary="$3"
  local repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
  # Library functions shouldn't depend on caller-set globals; default WORK_DIR
  # to a fresh tmp dir if the caller didn't set one.
  local work_dir="${WORK_DIR:-$(mktemp -d)}"

  # Build the diff-hunk map so we can pre-filter inline comments to anchors
  # GitHub will accept. Tests inject a fixture via POST_REVIEW_DIFF_FILE; the
  # production path runs `git diff` against the PR base. If the diff is
  # unavailable for any reason, fall back to an empty map (everything becomes
  # a general finding rather than risking a 422 round-trip).
  local diff_file valid_map
  if [ -n "${POST_REVIEW_DIFF_FILE:-}" ]; then
    diff_file="$POST_REVIEW_DIFF_FILE"
  else
    diff_file="$work_dir/pr-diff.patch"
    local base_ref="${GITHUB_BASE_REF:-main}"
    git diff "origin/$base_ref...HEAD" --unified=0 > "$diff_file" 2>/dev/null || : > "$diff_file"
  fi
  valid_map=$(inline_eligible_lines "$diff_file")

  # Annotate each finding with whether it can be anchored inline. A finding is
  # eligible iff it has a positive line AND that (path, line) sits inside a
  # diff hunk.
  local annotated_file="$work_dir/findings-annotated.jsonl"
  jq -c --argjson valid "$valid_map" '
    . as $f |
    $f + {_eligible: (
      $f.line != null and $f.line > 0 and
      (($valid[$f.path] // []) | any(. == $f.line))
    )}
  ' "$findings_file" > "$annotated_file"

  # Inline comments: only eligible findings.
  local comments_json
  comments_json=$(jq -s '
    [ .[] | select(._eligible) |
      { path: .path,
        line: .line,
        side: "RIGHT",
        body: ("**[" + (.severity|ascii_upcase) + " / " + .category + "]** " + .message)
      }
    ]
  ' "$annotated_file")

  # General findings: anything not anchored inline (no line, or outside any
  # hunk). Line numbers are kept in the rendered output when present so the
  # reader can still locate the issue.
  local general_md
  general_md=$(jq -r '
    select(._eligible | not) |
    "- **[" + (.severity|ascii_upcase) + " / " + .category + "]** `" + .path + "`" +
    (if .line and .line > 0 then ":L" + (.line|tostring) else "" end) +
    ": " + .message
  ' "$annotated_file" | sed '/^$/d')

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
  err_log="$work_dir/post-review-err.log"

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
  fallback_body=$(truncate_to_chars "$fallback_body" "$POST_REVIEW_BODY_MAX")

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
