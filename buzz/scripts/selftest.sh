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

# --- bootstrap-env.sh 冪等テスト（reviewer N1） ---
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/.env"
# 1 回目: sslip.io, オーナー pubkey aaaa1111（relay 鍵は override でテスト用に固定）
BUZZ_RELAY_KEY_OVERRIDE=deadbeef bash "$HERE/bootstrap-env.sh" "$FIX/env-example.env" "$OUT" 203.0.113.42 sslip.io aaaa1111 >/dev/null
pg1="$(grep '^POSTGRES_PASSWORD=' "$OUT")"
relay1="$(grep '^BUZZ_RELAY_PRIVATE_KEY=' "$OUT")"
check "domain uses sslip.io"  "BUZZ_DOMAIN=203-0-113-42.sslip.io" "$(grep '^BUZZ_DOMAIN=' "$OUT")"
check "owner pubkey written"  "RELAY_OWNER_PUBKEY=aaaa1111"        "$(grep '^RELAY_OWNER_PUBKEY=' "$OUT")"
check "no CHANGE_ME remains"  "0" "$(grep -c 'CHANGE_ME' "$OUT")"
check "typesense generated"   "0" "$(grep -c '^TYPESENSE_API_KEY=CHANGE_ME' "$OUT")"
check "auth token stays true" "BUZZ_REQUIRE_AUTH_TOKEN=true" "$(grep '^BUZZ_REQUIRE_AUTH_TOKEN=' "$OUT")"
# reviewer N3: 既知リスト外の CHANGE_ME が動的掃討で埋まったことを確認（掃討ループの実効テスト）
check "unlisted var swept"    "0" "$(grep -c '^SOME_NEW_UPSTREAM_VAR=CHANGE_ME' "$OUT")"
check "unlisted var has hex"  "1" "$(grep -Ec '^SOME_NEW_UPSTREAM_VAR=[0-9a-f]{64}$' "$OUT")"
# reviewer 指摘4: デスクトップ GUI 用に CORS がドメイン + Tauri origin を列挙しているか（* は relay panic のため不可）
check "cors lists domain+tauri" "1" "$(grep -Ec '^BUZZ_CORS_ORIGINS=.*sslip\.io.*tauri\.localhost' "$OUT")"
# 2 回目: nip.io, 同じオーナー pubkey（再ブートストラップを模す）
BUZZ_RELAY_KEY_OVERRIDE=deadbeef bash "$HERE/bootstrap-env.sh" "$FIX/env-example.env" "$OUT" 203.0.113.42 nip.io aaaa1111 >/dev/null
check "secret PRESERVED on re-run"    "$pg1"    "$(grep '^POSTGRES_PASSWORD=' "$OUT")"
check "relay key PRESERVED on re-run" "$relay1" "$(grep '^BUZZ_RELAY_PRIVATE_KEY=' "$OUT")"
check "domain REWRITTEN on re-run"    "BUZZ_DOMAIN=203-0-113-42.nip.io" "$(grep '^BUZZ_DOMAIN=' "$OUT")"

# --- 全スクリプトの静的検査（bash -n + shellcheck）。過金 VM の前にここで潰す ---
for s in "$HERE"/*.sh; do
  bash -n "$s" || { echo "FAIL - bash -n $s"; fail=1; }
done
if command -v shellcheck >/dev/null; then
  shellcheck -e SC1090,SC1091 "$HERE"/*.sh || { echo "FAIL - shellcheck"; fail=1; }
else
  echo "note - shellcheck not installed; bash -n only"
fi

# --- Python ヘルパの静的検査 + hex2nsec の NIP-19 適合（reviewer 指摘3） ---
for p in "$HERE"/*.py; do
  [ -e "$p" ] || continue
  python3 -m py_compile "$p" || { echo "FAIL - py_compile $p"; fail=1; }
done
check "hex2nsec NIP-19 vector" \
  "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5" \
  "$(python3 "$HERE/hex2nsec.py" 67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa)"

exit "$fail"
