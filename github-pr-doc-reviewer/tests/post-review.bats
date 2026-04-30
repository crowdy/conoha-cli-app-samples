#!/usr/bin/env bats
# Unit tests for post_review's 422-fallback and body-truncation paths in
# action/scripts/lib/github.sh. Mocks the `gh` CLI by prepending a stub
# directory to PATH; the stub records the requested URL and JSON payload to
# files the tests can inspect, and chooses its exit code from $GH_MOCK_MODE.

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$SCRIPT_DIR/action/scripts/lib/github.sh"

  WORK_DIR="$BATS_TEST_TMPDIR/work"
  mkdir -p "$WORK_DIR"
  export WORK_DIR
  export GITHUB_REPOSITORY="test-owner/test-repo"

  MOCK_BIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$MOCK_BIN"
  cat > "$MOCK_BIN/gh" <<'STUB'
#!/usr/bin/env bash
# Capture the JSON payload from stdin and the URL from positional args, write
# them under $WORK_DIR (the parent process exports it). Exit per GH_MOCK_MODE.
mkdir -p "$WORK_DIR/gh-calls"
# Count only *.payload files so the index stays sequential (each call writes
# both <i>.payload and <i>.url).
i=$(ls "$WORK_DIR/gh-calls"/*.payload 2>/dev/null | wc -l)
url=""
for a in "$@"; do
  case "$a" in repos/*/pulls/*/reviews) url="$a" ;; esac
done
cat > "$WORK_DIR/gh-calls/${i}.payload"
echo "$url" > "$WORK_DIR/gh-calls/${i}.url"
case "${GH_MOCK_MODE:-accept}" in
  reject_all)
    echo '{"message":"Unprocessable Entity","errors":["Line could not be resolved"]}'
    echo "gh: Unprocessable Entity (HTTP 422)" >&2
    exit 22
    ;;
  reject_first)
    if [ "$i" -eq 0 ]; then
      echo '{"message":"Unprocessable Entity","errors":["Line could not be resolved"]}'
      echo "gh: Unprocessable Entity (HTTP 422)" >&2
      exit 22
    fi
    exit 0
    ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "$MOCK_BIN/gh"
  PATH="$MOCK_BIN:$PATH"; export PATH
}

# ---------------------------------------------------------------------------
# truncate_to_chars
# ---------------------------------------------------------------------------

@test "truncate_to_chars: passes short input through unchanged" {
  run truncate_to_chars "hello" 100
  [ "$status" -eq 0 ]
  [ "$output" = "hello" ]
}

@test "truncate_to_chars: trims long input and appends a marker" {
  # max must exceed marker length (~130 chars) for a marker to be appended.
  s=$(printf 'x%.0s' $(seq 1 1000))
  run truncate_to_chars "$s" 500
  [ "$status" -eq 0 ]
  [ "${#output}" -le 500 ]
  echo "$output" | grep -qF 'body truncated'
}

@test "truncate_to_chars: when max smaller than marker, truncate hard without marker" {
  s=$(printf 'x%.0s' $(seq 1 200))
  run truncate_to_chars "$s" 50
  [ "$status" -eq 0 ]
  [ "${#output}" -le 50 ]
}

# ---------------------------------------------------------------------------
# post_review happy path
# ---------------------------------------------------------------------------

@test "post_review: happy path posts once with inline comments" {
  cat > "$WORK_DIR/findings.jsonl" <<'EOF'
{"path":"a.md","line":3,"severity":"warning","category":"todo-marker","message":"TBD: foo"}
{"path":"b.md","line":7,"severity":"error","category":"broken-internal-link","message":"missing target"}
EOF
  GH_MOCK_MODE=accept run post_review 1 "$WORK_DIR/findings.jsonl" "summary"
  [ "$status" -eq 0 ]
  [ -f "$WORK_DIR/gh-calls/0.payload" ]
  # Exactly one POST.
  [ "$(ls "$WORK_DIR/gh-calls" | grep -c '\.payload$')" -eq 1 ]
  # Inline comments present.
  jq -e '.comments | length == 2' "$WORK_DIR/gh-calls/0.payload"
  jq -e '.comments[0].path == "a.md"' "$WORK_DIR/gh-calls/0.payload"
  jq -e '.event == "COMMENT"' "$WORK_DIR/gh-calls/0.payload"
}

# ---------------------------------------------------------------------------
# post_review fallback on 422
# ---------------------------------------------------------------------------

@test "post_review: falls back to body-only review on 422" {
  cat > "$WORK_DIR/findings.jsonl" <<'EOF'
{"path":"a.md","line":3,"severity":"warning","category":"todo-marker","message":"TBD: foo"}
{"path":"b.md","line":7,"severity":"error","category":"broken-internal-link","message":"missing"}
{"path":"c.md","line":null,"severity":"info","category":"general","message":"file-level note"}
EOF
  GH_MOCK_MODE=reject_first run post_review 1 "$WORK_DIR/findings.jsonl" "summary"
  [ "$status" -eq 0 ]
  # Two POSTs: one rejected with inline comments, one accepted body-only.
  [ "$(ls "$WORK_DIR/gh-calls" | grep -c '\.payload$')" -eq 2 ]
  # First payload had inline comments.
  jq -e '.comments | length == 2' "$WORK_DIR/gh-calls/0.payload"
  # Second payload (fallback) is body-only.
  jq -e '.comments | length == 0' "$WORK_DIR/gh-calls/1.payload"
  # Fallback body lists ALL findings (inline + general).
  body=$(jq -r '.body' "$WORK_DIR/gh-calls/1.payload")
  echo "$body" | grep -qF 'a.md'
  echo "$body" | grep -qF 'b.md'
  echo "$body" | grep -qF 'c.md'
  echo "$body" | grep -qF 'Inline anchoring failed'
}

@test "post_review: returns 1 when both attempts fail" {
  cat > "$WORK_DIR/findings.jsonl" <<'EOF'
{"path":"a.md","line":3,"severity":"warning","category":"x","message":"m"}
EOF
  GH_MOCK_MODE=reject_all run post_review 1 "$WORK_DIR/findings.jsonl" "summary"
  [ "$status" -eq 1 ]
  # Expect both POSTs to have been attempted before giving up.
  [ "$(ls "$WORK_DIR/gh-calls" | grep -c '\.payload$')" -eq 2 ]
}

# ---------------------------------------------------------------------------
# post_review fallback truncation
# ---------------------------------------------------------------------------

@test "post_review: fallback body is capped under POST_REVIEW_BODY_MAX" {
  # Generate enough findings that the consolidated body would exceed the cap.
  : > "$WORK_DIR/findings.jsonl"
  for i in $(seq 1 200); do
    msg=$(printf 'a%.0s' $(seq 1 200))   # 200-char message per finding
    printf '{"path":"f%d.md","line":%d,"severity":"warning","category":"x","message":"%s"}\n' \
      "$i" "$i" "$msg" >> "$WORK_DIR/findings.jsonl"
  done
  POST_REVIEW_BODY_MAX=2000 GH_MOCK_MODE=reject_first \
    run post_review 1 "$WORK_DIR/findings.jsonl" "summary"
  [ "$status" -eq 0 ]
  body=$(jq -r '.body' "$WORK_DIR/gh-calls/1.payload")
  [ "${#body}" -le 2000 ]
  echo "$body" | grep -qF 'body truncated'
}
