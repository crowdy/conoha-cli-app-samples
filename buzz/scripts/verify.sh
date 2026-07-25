#!/usr/bin/env bash
# 完了条件を再実行し原文キャプチャ。秘密鍵は出力しない。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
load_ref
SERVER="${SERVER:-buzz-sample}"
SECRETS="$HERE/../.secrets"
FQDN="$(cat "$SECRETS/fqdn")"; OWNER_PUB="$(cat "$SECRETS/owner.pub")"
DC="cd /opt/buzz/deploy/compose && docker compose"
CURL_K="${CURL_K:-}"   # tls internal フォールバック時は CURL_K=-k を渡す（自己署名経路の明示）
pass=0

echo "== 0. image↔source identity =="
SRC="$(ssh_vm 'cd /opt/buzz && git rev-parse --short=7 HEAD')"
TAG="${BUZZ_IMAGE##*:sha-}"
if [ "$SRC" = "$TAG" ]; then echo "OK  src=$SRC == image=$TAG"; else echo "FAIL src=$SRC image=$TAG"; pass=1; fi

echo "== 1. relay liveness (VM, 3000/8080 両方に存在) =="
if ssh_vm "$DC exec -T relay sh -c 'curl -fsS http://127.0.0.1:8080/_liveness || curl -fsS http://127.0.0.1:3000/_liveness'"; then
  echo "OK liveness"
else
  echo "FAIL liveness"; pass=1
fi

echo "== 2. external reachability (local) — NIP-11 over HTTPS, NOT chat UI =="
# 実測 2026-07-25: この SHA は NIP-11 を content-type: application/json で返す（spec の想定した
# application/nostr+json ではない）。content-type ではなく本文が NIP-11 relay info であることを検証する
# （software に block/buzz、supported_nips が配列）。§8.2 の [仮定] を実機で消し込んだ結果。
# SC2086 disable: CURL_K は空 or '-k'。空のとき '' を curl に渡さないため意図的に非クォート（word-split 前提）。
# shellcheck disable=SC2086
BODY="$(curl -fsS $CURL_K -H 'Accept: application/nostr+json' "https://${FQDN}/")"
# shellcheck disable=SC2086
CT="$(curl -fsS $CURL_K -H 'Accept: application/nostr+json' -o /dev/null -w '%{content_type}' "https://${FQDN}/")"
if [ -n "$CURL_K" ]; then echo "   content-type=$CT (self-signed / tls internal)"; else echo "   content-type=$CT (LE path)"; fi
if printf '%s' "$BODY" | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
sys.exit(0 if "block/buzz" in (d.get("software") or "") and isinstance(d.get("supported_nips"), list) else 1)'; then
  echo "OK NIP-11 served (software=block/buzz, supported_nips present; ct=$CT)"
else
  echo "FAIL / not NIP-11 (ct=$CT)"; pass=1
fi

echo "== 3. WSS + NIP-42 (local) =="
# curl の 101 は「認証前」の upgrade にすぎない（spec §7: 全拒否リレーでも 101）。
# NIP-42 の実証はエージェント応答（Task 8 項目 7）が担う。ここは 101 の有無のみ参考出力。
# shellcheck disable=SC2086
if curl -fsS $CURL_K -i -N --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  "https://${FQDN}/" 2>&1 | grep -qiE '101 Switching Protocols'; then
  echo "OK 101 upgrade (NIP-42 の実証は Task 8 項目 7)"
else
  echo "WARN no 101 via curl (NIP-42 は Task 8 で判定)"
fi

echo "== 4. owner registered (VM, bootstrap_owner による自動登録) =="
# 起動時 bootstrap_owner が RELAY_OWNER_PUBKEY をメンバー登録する（relay-main.rs:294）。add-member 不要。
if ssh_vm "$DC exec -T relay buzz-admin list-members" | grep -qi "$OWNER_PUB"; then
  echo "OK owner in members ($OWNER_PUB)"
else
  echo "FAIL owner not in members"; pass=1
fi

if [ "$pass" = 0 ]; then echo "== relay checks: ALL PASS =="; else echo "== relay checks: HAS FAILURES =="; fi
exit "$pass"
