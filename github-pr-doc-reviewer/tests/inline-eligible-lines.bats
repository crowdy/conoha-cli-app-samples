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
