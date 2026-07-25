#!/usr/bin/env bash
# ローカル純関数テスト（VM 不要・課金なし）。Phase B の前に必ず緑にする。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
FIX="$HERE/../tests/fixtures"
fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: expected [$2] got [$3]"; fail=1; fi
}

# pubip: 公開 IPv4 を 1 個返す
check "pubip picks public v4" "203.0.113.42" "$(pubip < "$FIX/server-show.json")"
# pubip: 公開 IPv4 が無ければ空（負の対照）
check "pubip empty when no public" "" "$(pubip < "$FIX/server-show-priv.json")"
# ip_to_dashes
check "ip_to_dashes" "203-0-113-42" "$(ip_to_dashes 203.0.113.42)"

# --- 全スクリプトの静的検査（bash -n + shellcheck）。過金 VM の前にここで潰す ---
for s in "$HERE"/*.sh; do
  bash -n "$s" || { echo "FAIL - bash -n $s"; fail=1; }
done
if command -v shellcheck >/dev/null; then
  shellcheck -e SC1090,SC1091 "$HERE"/*.sh || { echo "FAIL - shellcheck"; fail=1; }
else
  echo "note - shellcheck not installed; bash -n only"
fi

exit "$fail"
