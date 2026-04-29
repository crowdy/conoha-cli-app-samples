#!/usr/bin/env bash
# Doc-reviewer runner entrypoint: verify claude CLI + auth, then delegate to base entrypoint.

set -euo pipefail

if command -v claude >/dev/null 2>&1; then
  echo "[doc-reviewer] claude CLI: $(claude --version 2>/dev/null || echo 'present')"
else
  echo "[doc-reviewer] WARNING: claude CLI not found in PATH" >&2
fi

if [ -f "$HOME/.claude/.credentials.json" ] || \
   [ -f "$HOME/.claude/credentials.json" ] || \
   [ -d "$HOME/.config/claude" ]; then
  echo "[doc-reviewer] Claude OAuth credentials detected"
else
  echo "[doc-reviewer] WARNING: Claude OAuth credentials not found at \$HOME/.claude/" >&2
  echo "[doc-reviewer] Run: docker exec -it <container> claude   (one-time, interactive)" >&2
fi

# Delegate to upstream myoung34/github-runner entrypoint
exec /entrypoint.sh "$@"
