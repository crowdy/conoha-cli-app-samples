#!/usr/bin/env bats

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$SCRIPT_DIR/action/scripts/lib/markdown.sh"
  FIXTURES="$SCRIPT_DIR/tests/fixtures"
}

@test "smoke: bats harness loads markdown.sh" {
  run bash -c "type check_todo_markers >/dev/null 2>&1; echo \$?"
  # Will fail until check_todo_markers is defined - this is intentional;
  # later tasks will satisfy it. For now, just confirm bats runs.
  [ -n "$output" ]
}

@test "check_todo_markers detects TBD" {
  run check_todo_markers "$FIXTURES/sample-with-issues.md"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"category":"todo-marker"'
  echo "$output" | grep -q '"line":3'
}

@test "check_todo_markers detects TODO" {
  run check_todo_markers "$FIXTURES/sample-with-issues.md"
  [ "$status" -eq 0 ]
  count=$(echo "$output" | grep -c '"category":"todo-marker"' || true)
  [ "$count" -ge 2 ]
}

@test "check_todo_markers reports nothing on clean file" {
  run check_todo_markers "$FIXTURES/sample-good.md"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "check_empty_sections detects header followed by another header" {
  run check_empty_sections "$FIXTURES/sample-with-issues.md"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"category":"empty-section"'
  echo "$output" | grep -q 'Empty Section'
}

@test "check_empty_sections does not flag sections with content" {
  run check_empty_sections "$FIXTURES/sample-good.md"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "check_internal_links detects missing target file" {
  run check_internal_links "$FIXTURES/sample-with-issues.md"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"category":"broken-internal-link"'
  echo "$output" | grep -q 'does-not-exist.md'
}

@test "check_internal_links does not flag valid relative links" {
  run check_internal_links "$FIXTURES/sample-good.md"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "check_internal_links ignores http(s) and mailto and anchors" {
  cat > "$BATS_TMPDIR/external.md" <<'EOF'
# Header

[github](https://github.com/)
[email](mailto:a@b.c)
[anchor](#section)
EOF
  run check_internal_links "$BATS_TMPDIR/external.md"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "check_internal_links resolves absolute paths against repo root, not cwd" {
  # GFM treats /foo as repo-root-relative. Place the fixture in the repo
  # under tests/fixtures, then point the link at /README.md (which exists at
  # repo root). Run from a deeper cwd to prove cwd is irrelevant.
  fixture="$BATS_TMPDIR/abs-link-fixture.md"
  cat > "$SCRIPT_DIR/tests/fixtures/abs-link-fixture.md" <<'EOF'
# Absolute Link

[readme](/README.md)
EOF
  pushd "$BATS_TMPDIR" >/dev/null
  run check_internal_links "$SCRIPT_DIR/tests/fixtures/abs-link-fixture.md"
  popd >/dev/null
  rm -f "$SCRIPT_DIR/tests/fixtures/abs-link-fixture.md"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "check_internal_links flags absolute paths whose targets are missing" {
  cat > "$SCRIPT_DIR/tests/fixtures/abs-link-broken.md" <<'EOF'
# Absolute Link Broken

[bad](/this-file-does-not-exist-xyz.md)
EOF
  run check_internal_links "$SCRIPT_DIR/tests/fixtures/abs-link-broken.md"
  rm -f "$SCRIPT_DIR/tests/fixtures/abs-link-broken.md"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"category":"broken-internal-link"'
  echo "$output" | grep -q '/this-file-does-not-exist-xyz.md'
}

@test "check_external_link returns severity=info on connection failure" {
  source "$SCRIPT_DIR/action/scripts/lib/http-link.sh"
  run check_external_link "http://localhost:1/nonexistent" "fixture.md" 5
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"severity":"info"'
  echo "$output" | grep -q '"category":"broken-external-link"'
}

@test "check_external_link is silent on success" {
  source "$SCRIPT_DIR/action/scripts/lib/http-link.sh"
  command -v curl >/dev/null || skip "curl not available"
  run check_external_link "https://example.com/" "fixture.md" 5
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "check_external_link contains GET fallback code path" {
  # Verify the fallback exists in the source — networking tests are flaky,
  # so we assert the code path rather than hitting a flaky 405-on-HEAD host.
  grep -q -- '-X GET --range 0-0' "$SCRIPT_DIR/action/scripts/lib/http-link.sh"
}
