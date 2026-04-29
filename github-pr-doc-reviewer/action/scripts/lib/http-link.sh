#!/usr/bin/env bash
# External HTTP link checks. Single retry, conservative reporting.

set -euo pipefail

# check_external_link URL FILE LINE
# Emits JSON Line on failure (after retry). Silent on success.
check_external_link() {
  local url="$1"
  local file="$2"
  local line="${3:-0}"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -I "$url" 2>/dev/null) || true
  [ -z "$code" ] && code="000"
  if [ "$code" = "000" ] || [ "${code:0:1}" = "4" ] || [ "${code:0:1}" = "5" ]; then
    sleep 1
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -I "$url" 2>/dev/null) || true
    [ -z "$code" ] && code="000"
    if [ "$code" = "000" ] || [ "${code:0:1}" = "4" ] || [ "${code:0:1}" = "5" ]; then
      jq -nc \
        --arg path "$file" \
        --argjson line "$line" \
        --arg msg "External link unreachable ($code): $url" \
        '{path: $path, line: $line, severity: "info", category: "broken-external-link", message: $msg}'
    fi
  fi
}
