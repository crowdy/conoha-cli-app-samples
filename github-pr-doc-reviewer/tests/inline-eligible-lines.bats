#!/usr/bin/env bats
# Unit tests for inline_eligible_lines: parses `git diff --unified=0` output
# and emits a {path: [lines]} JSON map for lines on the new side of each
# hunk — the only lines GitHub will accept as inline review-comment anchors.

setup() {
  SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  source "$SCRIPT_DIR/action/scripts/lib/github.sh"
  DIFF="$BATS_TEST_TMPDIR/diff.patch"
}

@test "empty diff file → {}" {
  : > "$DIFF"
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -c '.')" = "{}" ]
}

@test "single hunk with explicit count → range of lines" {
  cat > "$DIFF" <<'EOF'
diff --git a/foo.md b/foo.md
--- a/foo.md
+++ b/foo.md
@@ -10,0 +10,3 @@
+alpha
+beta
+gamma
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  result=$(echo "$output" | jq -c '."foo.md"')
  [ "$result" = "[10,11,12]" ]
}

@test "single-line hunk without count → one line, count defaults to 1" {
  cat > "$DIFF" <<'EOF'
diff --git a/foo.md b/foo.md
--- a/foo.md
+++ b/foo.md
@@ -5 +7 @@
-old
+new
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  result=$(echo "$output" | jq -c '."foo.md"')
  [ "$result" = "[7]" ]
}

@test "pure deletion (new_count=0) → file not in map" {
  cat > "$DIFF" <<'EOF'
diff --git a/foo.md b/foo.md
--- a/foo.md
+++ b/foo.md
@@ -5,2 +4,0 @@
-line a
-line b
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  has=$(echo "$output" | jq 'has("foo.md")')
  [ "$has" = "false" ]
}

@test "multiple hunks in same file → lines merged" {
  cat > "$DIFF" <<'EOF'
diff --git a/foo.md b/foo.md
--- a/foo.md
+++ b/foo.md
@@ -2,0 +3,2 @@
+first
+second
@@ -10,0 +13,1 @@
+third
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  result=$(echo "$output" | jq -c '."foo.md" | sort')
  [ "$result" = "[3,4,13]" ]
}

@test "multiple files → both appear in map" {
  cat > "$DIFF" <<'EOF'
diff --git a/a.md b/a.md
--- a/a.md
+++ b/a.md
@@ -0,0 +1,2 @@
+one
+two
diff --git a/dir/b.md b/dir/b.md
--- a/dir/b.md
+++ b/dir/b.md
@@ -3,0 +4,1 @@
+three
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -c '."a.md"')" = "[1,2]" ]
  [ "$(echo "$output" | jq -c '."dir/b.md"')" = "[4]" ]
}

@test "deleted file (+++ /dev/null) → not in map" {
  cat > "$DIFF" <<'EOF'
diff --git a/gone.md b/gone.md
--- a/gone.md
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  has=$(echo "$output" | jq 'has("gone.md")')
  [ "$has" = "false" ]
}

@test "new file (--- /dev/null) → counted normally" {
  cat > "$DIFF" <<'EOF'
diff --git a/new.md b/new.md
--- /dev/null
+++ b/new.md
@@ -0,0 +1,3 @@
+a
+b
+c
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  result=$(echo "$output" | jq -c '."new.md"')
  [ "$result" = "[1,2,3]" ]
}

@test "path containing whitespace → preserved (no truncation at space)" {
  # Regression for review I1: default awk field-splitting on $2 truncated
  # `+++ b/with space/foo.md` to just `b/with`, silently rerouting findings
  # on whitespace-bearing paths to the body.
  cat > "$DIFF" <<'EOF'
diff --git a/with space/foo.md b/with space/foo.md
--- a/with space/foo.md
+++ b/with space/foo.md
@@ -0,0 +1,2 @@
+one
+two
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -c '."with space/foo.md"')" = "[1,2]" ]
  [ "$(echo "$output" | jq 'has("with")')" = "false" ]
}

@test "path with trailing tab+timestamp → timestamp stripped" {
  # Some git versions emit `+++ b/foo.md\t<timestamp>` when configured with
  # `--src-prefix=`/`--dst-prefix=` or `format-patch`. The timestamp must
  # not appear in the path key.
  printf '%s\n' \
    'diff --git a/foo.md b/foo.md' \
    '--- a/foo.md	2026-05-11 12:00:00.000000000 +0900' \
    '+++ b/foo.md	2026-05-11 12:00:01.000000000 +0900' \
    '@@ -0,0 +1,1 @@' \
    '+line' > "$DIFF"
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -c '."foo.md"')" = "[1]" ]
}

@test "path that itself starts with b/ → only the leading b/ prefix stripped" {
  # Regression: make sure sub(/^b\//, ...) is anchored — a real path named
  # `b/foo.md` (git emits `+++ b/b/foo.md`) must remain `b/foo.md` in the map.
  cat > "$DIFF" <<'EOF'
diff --git a/b/foo.md b/b/foo.md
--- a/b/foo.md
+++ b/b/foo.md
@@ -0,0 +1,1 @@
+x
EOF
  run inline_eligible_lines "$DIFF"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -c '."b/foo.md"')" = "[1]" ]
}
