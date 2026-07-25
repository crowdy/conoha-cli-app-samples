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

if [ "${1:-}" = "--agent" ]; then
  AGENT_PUB="$(cat "$SECRETS/agent.pub")"; CH="$(cat "$SECRETS/channel")"
  { [ -n "$AGENT_PUB" ] && [ -n "$CH" ]; } || { echo "FAIL agent.pub/channel missing (run agent-up.sh first)"; exit 1; }

  echo "== 5. agent registered (VM) =="
  if ssh_vm "$DC exec -T relay buzz-admin list-members" | grep -qi "$AGENT_PUB"; then
    echo "OK agent in members ($AGENT_PUB)"
  else
    echo "FAIL agent not in members"; pass=1
  fi

  echo "== 6. harness active + allowlist gate (VM) =="
  if ssh_vm 'systemctl is-active buzz-acp' | grep -q active \
     && ssh_vm 'systemctl show buzz-acp -p Environment' | grep -q 'BUZZ_ACP_RESPOND_TO=allowlist'; then
    echo "OK buzz-acp active + respond_to=allowlist"
  else
    echo "FAIL harness/gate"; pass=1
  fi
  echo "-- drop/dead-letter counter (spec §7 項目6, informational) --"
  ssh_vm 'journalctl -u buzz-acp --no-pager | grep -ic "drop\|dead-letter" || true'

  # 送信=オーナー（/root/.buzz-owner.env, nsec 非ログ）。検出=作成者 pubkey==AGENT_PUB かつトークン包含。
  # messages get の実測 JSON: 配列 [{pubkey, content, id, kind, ...}]。--format フラグは無い（既定 JSON）。
  send_owner() { # <content>
    ssh_vm "set -a; . /root/.buzz-owner.env; set +a; buzz messages send --channel $CH --content '$1'" >/dev/null
  }
  detect() {     # <token> → agent(pubkey==AGENT_PUB) 作成の当該トークン投稿があれば 0
    ssh_vm "set -a; . /root/.buzz-owner.env; set +a; buzz messages get --channel $CH --limit 50" \
      | python3 -c 'import sys,json
tok=sys.argv[1]; ap=sys.argv[2].lower()
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
msgs=d if isinstance(d,list) else d.get("messages",[])
sys.exit(0 if any((m.get("pubkey") or "").lower()==ap and tok in (m.get("content") or "") for m in msgs) else 1)' "$1" "$AGENT_PUB"
  }

  # 7-N 偽陰性対照（reviewer N5）: @mention を含まない本文を送る。subscribe=mentions なので配信されず応答は起きない。
  # 検出器が壊れていれば（作成者フィルタ不良で）オーナー投稿に誤マッチして FAIL する。ゲート反転も restart も伴わない真の陰性対照。
  echo "== 7-N. negative control: non-mention body must yield NO agent reply =="
  TOKN="NEG$(openssl rand -hex 3)"
  send_owner "plain note without mention, token $TOKN"
  neg=0; for _ in $(seq 1 7); do sleep 10; if detect "$TOKN"; then neg=1; break; fi; done
  if [ "$neg" = 1 ]; then
    echo "FAIL negative control matched — detector/mention-filter not discriminating"; pass=1
  else
    echo "OK no agent reply to non-mention (detector discriminates)"
  fi

  # 7 本検証: 同一 detect でエージェント作成の応答を要求。成立=閉リレーで NIP-42＋メンバーシップ＋mention 経路を実証。
  echo "== 7. agent replies to @mention (CORE; proves NIP-42 + membership + routing) =="
  TOK="CORE$(openssl rand -hex 3)"
  send_owner "@agent Reply in this channel with exactly this token and nothing else: $TOK"
  ok7=0; for _ in $(seq 1 15); do sleep 8; if detect "$TOK"; then ok7=1; break; fi; done
  if [ "$ok7" = 1 ]; then
    echo "OK agent authored a reply containing the token ($TOK)"
  else
    echo "FAIL no agent-authored reply in ~120s"; pass=1
  fi
fi

if [ "$pass" = 0 ]; then echo "== checks: ALL PASS =="; else echo "== checks: HAS FAILURES =="; fi
exit "$pass"
