#!/usr/bin/env bash
# .env を冪等生成する。秘密は保存、ドメイン変数とオーナー pubkey は書き直す（spec §4.1, reviewer N1）。
# 使い方: bootstrap-env.sh <env_example> <out_env> <ipv4> <suffix> <owner_pubkey_hex>
set -euo pipefail
EXAMPLE="$1"; OUT="$2"; IP="$3"; SUFFIX="$4"; OWNER_PUB="$5"
DOMAIN="$(printf '%s' "$IP" | tr '.' '-').${SUFFIX}"

# 既存 .env が無ければ雛形から開始。あれば既存を尊重（秘密保存）。
[ -f "$OUT" ] || cp "$EXAMPLE" "$OUT"

# set_kv KEY VALUE — KEY 行を VALUE に置換（無ければ追記）
set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$OUT"; then
    # | 区切り sed。値に | を含めない前提（hex/URL のみ）。
    sed -i "s|^${k}=.*|${k}=${v}|" "$OUT"
  else
    printf '%s=%s\n' "$k" "$v" >> "$OUT"
  fi
}

# gen_secret KEY — 未生成（CHANGE_ME）または欠落時のみ生成。既存値は保存（不変条件）。
gen_secret() {
  local k="$1" cur
  # reviewer N7: キー不在時に grep が exit 1 → set -e+pipefail で即死するのを防ぐ（|| true）
  cur="$(grep "^${k}=" "$OUT" | head -1 | cut -d= -f2- || true)"
  if [ -z "$cur" ] || printf '%s' "$cur" | grep -q 'CHANGE_ME'; then
    set_kv "$k" "$(openssl rand -hex 32)"
  fi
}

# --- ドメイン派生 5 変数 + オーナー pubkey: 毎回書き直す ---
set_kv BUZZ_DOMAIN "$DOMAIN"
set_kv RELAY_URL "wss://${DOMAIN}"
set_kv BUZZ_MEDIA_BASE_URL "https://${DOMAIN}/media"
set_kv BUZZ_MEDIA_SERVER_DOMAIN "$DOMAIN"
set_kv BUZZ_CORS_ORIGINS "https://${DOMAIN}"
set_kv RELAY_OWNER_PUBKEY "$OWNER_PUB"

# --- 秘密・リレー鍵: 未生成のみ生成、既存は保存 ---
for k in BUZZ_GIT_HOOK_HMAC_SECRET POSTGRES_PASSWORD REDIS_PASSWORD \
         TYPESENSE_API_KEY BUZZ_S3_ACCESS_KEY BUZZ_S3_SECRET_KEY; do
  gen_secret "$k"
done
# リレー署名鍵: 未生成のみ buzz-admin generate-key（VM 上で BUZZ_IMAGE を使う。テストでは環境変数注入で回避）
if grep -q '^BUZZ_RELAY_PRIVATE_KEY=CHANGE_ME' "$OUT" || ! grep -q '^BUZZ_RELAY_PRIVATE_KEY=' "$OUT"; then
  if [ -n "${BUZZ_RELAY_KEY_OVERRIDE:-}" ]; then
    set_kv BUZZ_RELAY_PRIVATE_KEY "$BUZZ_RELAY_KEY_OVERRIDE"   # テスト用
  else
    # generate-key は「Public key: <hex>」「Secret key: <hex>」形式（実測 2026-07-25）。
    # 先頭 hex は Public。Secret 行から取らないとリレー秘密鍵に公開鍵を入れてしまう。
    key="$(docker run --rm --entrypoint buzz-admin "${BUZZ_IMAGE:?BUZZ_IMAGE required}" generate-key \
           | sed -n 's/^[[:space:]]*Secret key:[[:space:]]*//p' | grep -oiE '[0-9a-f]{64}' | head -1)"
    [ -n "$key" ] || { echo "generate-key produced no hex secret key" >&2; exit 1; }
    set_kv BUZZ_RELAY_PRIVATE_KEY "$key"
  fi
fi

# --- 固定 ---
set_kv BUZZ_AUTO_MIGRATE true
set_kv BUZZ_REQUIRE_AUTH_TOKEN true
[ -n "${BUZZ_IMAGE:-}" ] && set_kv BUZZ_IMAGE "$BUZZ_IMAGE"

# --- 残存 CHANGE_ME を動的に掃討（reviewer F7: 上流が日次で新変数を足すため固定目録では漏れる） ---
# run.sh:29 の CHANGE_ME ゲートは 1 件でも残ると起動を拒否する。既知キー以外もランダムで埋める。
while IFS= read -r line; do
  k="${line%%=*}"
  set_kv "$k" "$(openssl rand -hex 32)"
  echo "note: filled unlisted CHANGE_ME var $k with random hex" >&2
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=.*CHANGE_ME' "$OUT")

# 最終ガード: CHANGE_ME が 1 件でも残れば失敗（起動前に loud に）
if grep -Eq '^[A-Za-z_][A-Za-z0-9_]*=.*CHANGE_ME' "$OUT"; then
  echo "ERROR: CHANGE_ME placeholders remain in $OUT" >&2; exit 1
fi
echo "wrote $OUT (domain=$DOMAIN)"
