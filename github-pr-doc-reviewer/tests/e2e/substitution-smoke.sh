#!/usr/bin/env bash
# Smoke test for the prompt-template substitution in review-deep.sh.
#
# The substitution feeds attacker-controllable PR diff content into a
# template via sed (single-line scalars) and awk (multi-line bundles).
# A bug in either stage could:
#   - corrupt the prompt (turning $1, &, \1 into accidental backreferences)
#   - drop or duplicate content
#   - fail outright on edge bytes (\x01 used as sed delimiter)
#
# This test feeds the substitution adversarial bytes that would break a
# naive `sed -e "s|MARKER|$value|g"` implementation, and asserts the
# output preserves them byte-for-byte.
#
# TODO(I5): the awk script below is duplicated from review-deep.sh.
# A future refactor should extract the substitution into
# action/scripts/lib/prompt-substitute.sh and have both this test and
# review-deep.sh source it. Until then: any change to the awk script in
# review-deep.sh must be mirrored here.

set -euo pipefail

cd "$(dirname "$0")/../.."
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

CTX_DIR="$WORK_DIR/ctx"
mkdir -p "$CTX_DIR"

# --- Adversarial fixtures ---------------------------------------------------

# Single-line scalars stress the sed stage.
REPO='owner/repo-with-$&-and-\1-and-&'
PR_NUMBER='42'
PR_TITLE='Fix: handle $1 and \\ in titles & also \x01 control byte'

# Multi-line bundles stress the awk stage. Include:
#   - bare backslashes
#   - regex backrefs ($&, $1, \1, \0)
#   - the \x01 byte that the sed stage uses as its delimiter
#   - blank lines, leading whitespace, trailing whitespace
#   - the {{...}} marker syntax inside content (must NOT be treated as a marker)
PR_DIFF=$'diff --git a/foo b/foo\n'\
$'--- a/foo\n'\
$'+++ b/foo\n'\
$'@@ -1,3 +1,3 @@\n'\
$'-old line with $1 and \\backslash\n'\
$'+new line with $& and {{PR_DIFF}} (must stay literal)\n'\
$' context with \x01 control byte and trailing space   '

GLOSSARY=$'# Glossary\n\nfoo: $1\nbar: \\\\1\n\nblank line above'

ADR_BUNDLE=$'\n#### adr/0001.md\n\n```\n# Decision: use & operator\nWith \\1 and $&\n```\n'

SIBLING_BUNDLE=$'\n#### domains/x/api.yml\n\n```\nfoo: "{{GLOSSARY}}"\nbar: "$&"\n```\n'

printf '%s' "$PR_DIFF"        > "$CTX_DIR/pr_diff.txt"
printf '%s' "$GLOSSARY"       > "$CTX_DIR/glossary.txt"
printf '%s' "$ADR_BUNDLE"     > "$CTX_DIR/adr_bundle.txt"
printf '%s' "$SIBLING_BUNDLE" > "$CTX_DIR/sibling_bundle.txt"

# Build a template that mirrors prompts/deep-review.md but is small enough
# to assert against precisely.
PROMPT_TEMPLATE="$WORK_DIR/template.md"
cat > "$PROMPT_TEMPLATE" <<'EOF'
Repo: {{REPO}}
PR: #{{PR_NUMBER}} {{PR_TITLE}}

DIFF_START
{{PR_DIFF}}
DIFF_END

GLOSSARY_START
{{GLOSSARY}}
GLOSSARY_END

ADR_START
{{ADR_BUNDLE}}
ADR_END

SIB_START
{{SIBLING_BUNDLE}}
SIB_END
EOF

USER_PROMPT="$WORK_DIR/user-prompt.md"

# --- Stage 1: sed (lifted from review-deep.sh) -----------------------------
sed_escape() {
  printf '%s' "$1" | tr -d '\n\r' | sed -e 's/[\\&\x01]/\\&/g'
}
SAFE_REPO=$(sed_escape "$REPO")
SAFE_PR_NUMBER=$(sed_escape "$PR_NUMBER")
SAFE_PR_TITLE=$(sed_escape "$PR_TITLE")

sed \
  -e $'s\x01{{REPO}}\x01'"$SAFE_REPO"$'\x01g' \
  -e $'s\x01{{PR_NUMBER}}\x01'"$SAFE_PR_NUMBER"$'\x01g' \
  -e $'s\x01{{PR_TITLE}}\x01'"$SAFE_PR_TITLE"$'\x01g' \
  "$PROMPT_TEMPLATE" > "$USER_PROMPT.tmp"

# --- Stage 2: awk (lifted from review-deep.sh) -----------------------------
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
  function lit_replace(s, marker, value,    p, mlen, vlen, out, rest) {
    mlen = length(marker); vlen = length(value)
    out = ""; rest = s
    while ((p = index(rest, marker)) > 0) {
      out = out substr(rest, 1, p - 1) value
      rest = substr(rest, p + mlen)
    }
    return out rest
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

# --- Assertions ------------------------------------------------------------

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

# 1. Every adversarial scalar byte survives stage 1 (sed) literally.
grep -qF 'owner/repo-with-$&-and-\1-and-&' "$USER_PROMPT" \
  || fail "REPO scalar mangled by sed"
pass "REPO scalar preserved"

grep -qF 'Fix: handle $1 and \\ in titles & also \x01 control byte' "$USER_PROMPT" \
  || fail "PR_TITLE scalar mangled by sed"
pass "PR_TITLE scalar preserved"

# 2. Multi-line bundles survive stage 2 (awk) byte-for-byte.
grep -qF '+new line with $& and {{PR_DIFF}} (must stay literal)' "$USER_PROMPT" \
  || fail "PR_DIFF: nested marker or \$& not preserved"
pass "PR_DIFF: nested {{PR_DIFF}} marker stays literal (single-pass behavior)"

grep -qF -- '-old line with $1 and \backslash' "$USER_PROMPT" \
  || fail "PR_DIFF: backslash + \$1 not preserved"
pass "PR_DIFF: backslash + \$1 preserved"

grep -qF 'foo: $1' "$USER_PROMPT" \
  || fail "GLOSSARY: \$1 not preserved"
grep -qF 'bar: \\1' "$USER_PROMPT" \
  || fail "GLOSSARY: \\\\1 not preserved"
pass "GLOSSARY: regex-like content preserved"

grep -qF '# Decision: use & operator' "$USER_PROMPT" \
  || fail "ADR_BUNDLE: & not preserved"
grep -qF 'With \1 and $&' "$USER_PROMPT" \
  || fail "ADR_BUNDLE: \\1 / \$& not preserved"
pass "ADR_BUNDLE: regex-like content preserved"

grep -qF 'foo: "{{GLOSSARY}}"' "$USER_PROMPT" \
  || fail "SIBLING_BUNDLE: nested {{GLOSSARY}} marker should stay literal"
pass "SIBLING_BUNDLE: nested {{GLOSSARY}} stays literal (no recursive expansion)"

# 3. The \x01 byte from PR_DIFF (which collides with sed's delimiter) survives.
# The diff was placed via awk (stage 2), which has no special handling for
# \x01, so the byte must be present unchanged.
if ! grep -qF $'\x01 control byte' "$USER_PROMPT"; then
  fail "PR_DIFF: \\x01 byte was stripped"
fi
pass "PR_DIFF: \\x01 byte (sed delimiter) preserved through awk stage"

# 4. No marker should remain unsubstituted.
if grep -qE '\{\{(REPO|PR_NUMBER|PR_TITLE|PR_DIFF|GLOSSARY|ADR_BUNDLE|SIBLING_BUNDLE)\}\}' "$USER_PROMPT"; then
  # The nested markers we asserted above are inside content slurped from
  # ctx files, which lit_replace processes once per template line — so
  # `{{PR_DIFF}}` in the diff content and `{{GLOSSARY}}` in the sibling
  # bundle SHOULD remain (single-pass substitution). Re-grep more carefully
  # to ensure only those two known-literal cases remain:
  unexpected=$(grep -nE '\{\{(REPO|PR_NUMBER|PR_TITLE|PR_DIFF|GLOSSARY|ADR_BUNDLE|SIBLING_BUNDLE)\}\}' "$USER_PROMPT" \
    | grep -vE '\+new line with \$& and \{\{PR_DIFF\}\}' \
    | grep -vE 'foo: "\{\{GLOSSARY\}\}"' || true)
  if [ -n "$unexpected" ]; then
    echo "Unexpected unsubstituted markers:" >&2
    echo "$unexpected" >&2
    fail "template still contains markers after substitution"
  fi
fi
pass "no top-level template markers remain"

# 5. Byte-exact spot check: the output must contain a literal "${" sequence
# from PR_DIFF, not bash-expanded.
grep -qF '$1' "$USER_PROMPT" || fail "literal \$1 missing"
grep -qF '$&' "$USER_PROMPT" || fail "literal \$& missing"
pass "literal regex-replacement metachars preserved"

echo "=== substitution-smoke PASS ==="
