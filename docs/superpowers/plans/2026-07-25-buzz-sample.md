# Buzz セルフホスト サンプル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ConoHa VPS 1 台に Buzz リレー（block/buzz）を立て、Claude エージェントを常駐させ、`buzz` CLI からの `@mention` に応答することを実測で示すサンプルを `buzz/` に作る。

**Architecture:** 上流 `deploy/compose/` を固定コミット SHA で取得し、パッチせずに使う。オーバーレイ（scripts + `.buzz-ref`）だけを本リポジトリが所有する。TLS は Caddy が sslip.io + Let's Encrypt で終端し、`conoha proxy` は使わない（`conoha.yml` なし）。人間側クライアントは `buzz` CLI（バンドル Web にチャット UI は無い）。エージェントはホスト上の systemd プロセス（`buzz-acp` + `claude-agent-acp`）。

**Tech Stack:** bash, python3（JSON パース）, Docker Compose v2, ConoHa CLI v0.8.0, Rust 1.95.0（VM 上ビルド）, Node.js LTS + npm, Nostr。

**親スペック:** `docs/superpowers/specs/2026-07-24-buzz-sample-design.md`（rev 3.1）。**plan-reviewer にはこのスペックパスを必ず添付すること。**

## Global Constraints

スペックの全タスク共通制約。値はスペックから逐語コピー。

- **フレーバー:** `g2l-t-c6m8`（6 vCPU / 8GB, 時間課金）。VM 上で cargo build するため 4GB では不足（spec §3.2）。
- **上流ピン:** `.buzz-ref` に `BUZZ_GIT_REF`（40 桁完全コミット SHA）と `BUZZ_IMAGE`（`ghcr.io/block/buzz:sha-<7>`）。**イメージタグ → コミット SHA の順**で決める。リリース `v*` タグはイメージを発行しない（spec §3.1, `.github/workflows/docker.yml:11-20`）。
- **秘密の不変条件:** `.env` の秘密・リレー鍵・オーナー pubkey は再ブートストラップで**回転させない**（上流 `deploy/compose/run.sh:32` "must not rotate on restart"）。
- **オーナー秘密鍵:** サーバに置かない。ローカル `buzz/.secrets/owner.nsec`（`0600`）のみ。`tee` ログに出さない（spec §4.0）。
- **著者ゲート:** `buzz-acp` は既定 `owner-only` で **無言破棄**。systemd に `BUZZ_ACP_RESPOND_TO=allowlist` + `BUZZ_ACP_RESPOND_TO_ALLOWLIST=<owner pubkey hex>` を必須で入れる（spec §5.1, `crates/buzz-acp/src/config.rs:2270`）。
- **CLI バイナリ名:** `-p buzz-cli` の成果物は `buzz`（`target/release/buzz-cli` は存在しない。`crates/buzz-cli/Cargo.toml` `[[bin]] name = "buzz"`）。
- **`conoha.yml` を置かない**（Caddy が 80/443 を直接握るため。spec §2, 本リポジトリ README の例外規定）。
- **証拠規約:** 完了条件は `2>&1 | tee -a <ログ>` で原文キャプチャ。ただし秘密鍵は除外し、除外の事実をログに残す。要約は証拠として不可（本リポジトリ CLAUDE.md）。
- **偽陰性対照:** 完了条件 7（エージェント応答）は、その前に「必ず失敗する入力」で 1 回流し、検証コマンド自体が失敗を検出できることを確認してから本検証する（spec §7 項目 7-N）。
- **ドキュメント言語:** 日本語（本リポジトリ慣習）。コード・識別子・コミットは英語。

---

## 実行フェーズと前提

- **Phase A（Task 1–4）: ローカルで完結・課金なし。** 純粋ロジックとスクリプトの静的検証。fixture ベースの自己テストと `shellcheck` で回帰を防ぐ。**subagent 実行可。**
- **Phase B（Task 5–9）: 実 VPS が必要・時間課金発生。** `conoha` CLI 認証済み、ConoHa に SSH キーペア登録済み、ローカルに `git`/`bash`/`python3`、Claude 資格情報（サブスクリプション or `ANTHROPIC_API_KEY`）が前提。**subagent 単独では実行不可** — 人間が VM とクレデンシャルを用意して実行し、原文ログを添付する。
- **Phase C（Task 10–11）: ドキュメント。** subagent 実行可。

各 Phase B タスクは「課金 VM 上で 1 回実行し、原文キャプチャを残す」ことが完了条件。Phase A はその前に必ず緑にする（課金前にロジック回帰を潰す）。

## File Structure

```
buzz/
├── README.md               # 日本語。手順 / 注意 / トラブルシュート / 参考（Task 10）
├── .gitignore              # .secrets/ .env upstream/ *.log を除外（Task 1）
├── .buzz-ref               # BUZZ_GIT_REF / BUZZ_IMAGE（Task 1）
├── scripts/
│   ├── lib.sh              # 共有: die/log, pubip(stdin), ip_to_dashes, load_ref, ssh_vm（Task 2）
│   ├── selftest.sh         # ローカル純関数テスト（VM 不要, Task 2・3）
│   ├── down.sh             # 全リソース破棄（Task 4）
│   ├── up.sh               # リレー構築（Task 5）
│   ├── bootstrap-env.sh    # VM 内で .env を冪等生成（Task 3）
│   ├── verify.sh           # 完了条件（Task 6 でリレー分, Task 8 でエージェント分）
│   └── agent-up.sh         # VM 内でビルド→鍵→systemd（Task 7）
└── tests/
    └── fixtures/
        ├── server-show.json      # conoha server show の実形状（Task 2）
        ├── server-show-priv.json # 公開 IP 無し（負の対照, Task 2）
        └── env-example.env       # 上流 .env.example の写し（冪等テスト用, Task 3）
```

**責務分割:** `lib.sh` はローカル実行される純関数と SSH ラッパ。`bootstrap-env.sh` / `agent-up.sh` は **VM 上で自己完結**して動く（fresh VM に `lib.sh` を前提しない — 必要な小関数はインライン）。`selftest.sh` は課金前に回る唯一のテスト層で、reviewer が見つけた N1（冪等性）・pubip パースの回帰をここで捕まえる。

---

## Task 1: サンプル骨格と上流ピン

**Files:**
- Create: `buzz/.gitignore`
- Create: `buzz/.buzz-ref`
- Create: `buzz/tests/fixtures/` (ディレクトリ、`.gitkeep`)

**Interfaces:**
- Produces: `.buzz-ref` が `BUZZ_GIT_REF`（40 桁 SHA）と `BUZZ_IMAGE`（`ghcr.io/block/buzz:sha-<7>`）を定義。後続タスクの `load_ref`（Task 2）がこれを読む。

- [ ] **Step 1: ピンを実測で確定する**

GHCR の `:main` が指す現在の `sha-<7>` を取得し、完全 SHA に展開する。

```bash
# 現在の main イメージのダイジェスト経由でコミットを特定
TOKEN=$(curl -s "https://ghcr.io/token?scope=repository:block/buzz:pull&service=ghcr.io" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json" \
  "https://ghcr.io/v2/block/buzz/tags/list" | python3 -c 'import sys,json; ts=[t for t in json.load(sys.stdin)["tags"] if t.startswith("sha-")]; print("\n".join(ts[-5:]))'
# 得られた sha-XXXXXXX の 7 桁を完全 SHA に展開
git ls-remote https://github.com/block/buzz.git | grep <XXXXXXX>
```

Expected: `sha-<7>` タグが 1 件以上出る。`git ls-remote` でその 7 桁を含む完全 SHA が 1 件出る。**出なければ中断**（`:main` の指すコミットが GHCR タグと未同期 → 別の `sha-` を選ぶ）。

- [ ] **Step 2: `.buzz-ref` を書く**

`buzz/.buzz-ref`（`<40-HEX>` と `<7>` は Step 1 の実測値で置換）:

```sh
# 上流の完全コミット SHA と、それを発行元とするイメージタグ。
# 必ず「イメージタグ → コミット SHA」の順に決めること（spec §3.1）。
# 更新時は両方を同じコミットに揃え、verify.sh 項目 0 で機械照合される。
BUZZ_GIT_REF=<40-HEX>
BUZZ_IMAGE=ghcr.io/block/buzz:sha-<7>
```

- [ ] **Step 3: `.gitignore` を書く**

`buzz/.gitignore`:

```gitignore
# ローカルのみ。git に入れない。
.secrets/
.env
upstream/
*.log
```

- [ ] **Step 4: fixtures ディレクトリを作る**

```bash
mkdir -p buzz/tests/fixtures && touch buzz/tests/fixtures/.gitkeep
```

- [ ] **Step 5: コミット**

```bash
git add buzz/.gitignore buzz/.buzz-ref buzz/tests/fixtures/.gitkeep
git commit -m "feat(buzz): scaffold sample with pinned upstream ref"
```

---

## Task 2: 共有ライブラリと pubip の自己テスト

**Files:**
- Create: `buzz/scripts/lib.sh`
- Create: `buzz/scripts/selftest.sh`
- Create: `buzz/tests/fixtures/server-show.json`
- Create: `buzz/tests/fixtures/server-show-priv.json`

**Interfaces:**
- Produces:
  - `die MSG` — stderr に出して exit 1
  - `log MSG` — stderr に `[buzz] MSG`
  - `pubip` — **stdin から `conoha server show --format json` を読み**、公開 IPv4 を 1 個 stdout に出す（無ければ空）
  - `ip_to_dashes IP` — `203.0.113.42` → `203-0-113-42`
  - `load_ref` — `.buzz-ref` を source し `BUZZ_GIT_REF` / `BUZZ_IMAGE` を export（無ければ die）
  - `ssh_vm IP CMD...` — `ssh -o BatchMode=yes root@IP CMD`（Task 5 以降が使う）

- [ ] **Step 1: fixture を作る（実形状に基づく負の対照つき）**

`buzz/tests/fixtures/server-show.json`（`addresses` はネットワーク名キーの dict、値は `{addr,version}` のリスト。spec §5.0・memory 準拠）:

```json
{
  "id": "vm-abc123",
  "status": "ACTIVE",
  "addresses": {
    "ext-net": [
      {"addr": "203.0.113.42", "version": 4},
      {"addr": "2001:db8::1", "version": 6}
    ]
  }
}
```

`buzz/tests/fixtures/server-show-priv.json`（公開 IPv4 が無い＝**必ず空を返すべき**負の対照）:

```json
{
  "id": "vm-def456",
  "status": "ACTIVE",
  "addresses": {
    "priv-net": [
      {"addr": "10.0.0.5", "version": 4},
      {"addr": "192.168.1.9", "version": 4}
    ]
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`buzz/scripts/selftest.sh`:

```bash
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

exit "$fail"
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `bash buzz/scripts/selftest.sh`
Expected: FAIL（`lib.sh` が無い / 関数未定義でエラー、exit != 0）

- [ ] **Step 4: `lib.sh` を実装**

`buzz/scripts/lib.sh`:

```bash
#!/usr/bin/env bash
# ローカル実行される共有ヘルパ。VM 上では使わない（bootstrap/agent は自己完結）。
set -uo pipefail

die() { echo "[buzz] ERROR: $*" >&2; exit 1; }
log() { echo "[buzz] $*" >&2; }

# stdin の `conoha server show --format json` から公開 IPv4 を 1 個。無ければ空。
# addresses はネットワーク名キーの dict、値は {addr,version} のリスト（memory 準拠）。
pubip() {
  python3 -c '
import json,sys
d=json.load(sys.stdin)
def public(ip):
    if ip.startswith(("10.","127.","192.168.")): return False
    if ip.startswith("172."):
        o=int(ip.split(".")[1]); return not (16<=o<=31)
    return True
ips=[a["addr"] for net in d.get("addresses",{}).values()
     for a in net if a.get("version")==4 and public(a["addr"])]
print(ips[0] if ips else "")'
}

ip_to_dashes() { printf '%s' "$1" | tr '.' '-'; }

load_ref() {
  local ref="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.buzz-ref}"
  [ -f "$ref" ] || die ".buzz-ref not found at $ref"
  # shellcheck source=/dev/null
  . "$ref"
  [ -n "${BUZZ_GIT_REF:-}" ] || die "BUZZ_GIT_REF unset in .buzz-ref"
  [ -n "${BUZZ_IMAGE:-}" ]   || die "BUZZ_IMAGE unset in .buzz-ref"
  export BUZZ_GIT_REF BUZZ_IMAGE
}

ssh_vm() { local ip="$1"; shift; ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "root@${ip}" "$@"; }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `bash buzz/scripts/selftest.sh`
Expected: PASS（`ok - pubip picks public v4` / `ok - pubip empty when no public` / `ok - ip_to_dashes`、exit 0）

- [ ] **Step 6: shellcheck（あれば）**

Run: `command -v shellcheck && shellcheck buzz/scripts/lib.sh buzz/scripts/selftest.sh || echo "shellcheck not installed — skipped"`
Expected: 警告なし、または未インストールでスキップ

- [ ] **Step 7: コミット**

```bash
git add buzz/scripts/lib.sh buzz/scripts/selftest.sh buzz/tests/fixtures/server-show.json buzz/tests/fixtures/server-show-priv.json
git commit -m "feat(buzz): shared lib with tested pubip parser + negative control"
```

---

## Task 3: `bootstrap-env.sh`（冪等な .env 生成）

reviewer 指摘 N1 の回帰クラスをローカルで潰す。**秘密は再実行で保存、ドメイン変数とオーナー pubkey は毎回書き直す。**

**Files:**
- Create: `buzz/scripts/bootstrap-env.sh`
- Create: `buzz/tests/fixtures/env-example.env`
- Modify: `buzz/scripts/selftest.sh`（冪等テストを追加）

**Interfaces:**
- Consumes: `.buzz-ref` の `BUZZ_IMAGE`（上流 `.env.example` を持たない環境向けに、テストは fixture を使う）
- Produces: `bootstrap-env.sh <env_example_path> <out_env_path> <ipv4> <suffix> <owner_pubkey_hex>` — `.env` を冪等生成。VM 上では `<env_example_path>` = clone 内の `deploy/compose/.env.example`。

- [ ] **Step 1: 上流 .env.example の写しを fixture に置く**

`buzz/tests/fixtures/env-example.env`（テスト用の最小写し。実物の該当行だけ）:

```sh
BUZZ_IMAGE=ghcr.io/block/buzz:main
BUZZ_DOMAIN=buzz.example.com
RELAY_URL=wss://buzz.example.com
BUZZ_MEDIA_BASE_URL=https://buzz.example.com/media
BUZZ_MEDIA_SERVER_DOMAIN=buzz.example.com
BUZZ_CORS_ORIGINS=https://buzz.example.com
BUZZ_REQUIRE_AUTH_TOKEN=true
BUZZ_AUTO_MIGRATE=true
RELAY_OWNER_PUBKEY=CHANGE_ME_OWNER_PUBKEY_HEX
BUZZ_RELAY_PRIVATE_KEY=CHANGE_ME_64_HEX_PRIVATE_KEY
BUZZ_GIT_HOOK_HMAC_SECRET=CHANGE_ME_RANDOM_64_HEX
POSTGRES_PASSWORD=CHANGE_ME_RANDOM_PASSWORD
REDIS_PASSWORD=CHANGE_ME_RANDOM_PASSWORD
TYPESENSE_API_KEY=CHANGE_ME_RANDOM_API_KEY
BUZZ_S3_ACCESS_KEY=CHANGE_ME_RANDOM_ACCESS_KEY
BUZZ_S3_SECRET_KEY=CHANGE_ME_RANDOM_SECRET_KEY
BUZZ_S3_BUCKET=buzz-media
```

- [ ] **Step 2: 失敗する冪等テストを追加**

`buzz/scripts/selftest.sh` の `exit "$fail"` の直前に追記:

```bash
# --- bootstrap-env.sh 冪等テスト（reviewer N1） ---
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/.env"
# 1 回目: sslip.io, オーナー pubkey AAAA...
bash "$HERE/bootstrap-env.sh" "$FIX/env-example.env" "$OUT" 203.0.113.42 sslip.io aaaa1111 >/dev/null
pg1="$(grep '^POSTGRES_PASSWORD=' "$OUT")"
relay1="$(grep '^BUZZ_RELAY_PRIVATE_KEY=' "$OUT")"
check "domain uses sslip.io"  "BUZZ_DOMAIN=203-0-113-42.sslip.io" "$(grep '^BUZZ_DOMAIN=' "$OUT")"
check "owner pubkey written"  "RELAY_OWNER_PUBKEY=aaaa1111"        "$(grep '^RELAY_OWNER_PUBKEY=' "$OUT")"
check "no CHANGE_ME remains"  "0" "$(grep -c 'CHANGE_ME' "$OUT")"
check "typesense generated"   "0" "$(grep -c '^TYPESENSE_API_KEY=CHANGE_ME' "$OUT")"
check "auth token stays true" "BUZZ_REQUIRE_AUTH_TOKEN=true" "$(grep '^BUZZ_REQUIRE_AUTH_TOKEN=' "$OUT")"
# 2 回目: nip.io, 同じオーナー pubkey（再ブートストラップを模す）
bash "$HERE/bootstrap-env.sh" "$FIX/env-example.env" "$OUT" 203.0.113.42 nip.io aaaa1111 >/dev/null
check "secret PRESERVED on re-run"       "$pg1"    "$(grep '^POSTGRES_PASSWORD=' "$OUT")"
check "relay key PRESERVED on re-run"    "$relay1" "$(grep '^BUZZ_RELAY_PRIVATE_KEY=' "$OUT")"
check "domain REWRITTEN on re-run"       "BUZZ_DOMAIN=203-0-113-42.nip.io" "$(grep '^BUZZ_DOMAIN=' "$OUT")"
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `bash buzz/scripts/selftest.sh`
Expected: FAIL（`bootstrap-env.sh` 未作成）

- [ ] **Step 4: `bootstrap-env.sh` を実装**

`buzz/scripts/bootstrap-env.sh`（VM 上で自己完結。`lib.sh` に依存しない）:

```bash
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
  cur="$(grep "^${k}=" "$OUT" | head -1 | cut -d= -f2-)"
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
    key="$(docker run --rm --entrypoint buzz-admin "${BUZZ_IMAGE:?BUZZ_IMAGE required}" generate-key \
           | grep -oiE '[0-9a-f]{64}' | head -1)"
    [ -n "$key" ] || { echo "generate-key produced no hex key" >&2; exit 1; }
    set_kv BUZZ_RELAY_PRIVATE_KEY "$key"
  fi
fi

# --- 固定 ---
set_kv BUZZ_AUTO_MIGRATE true
set_kv BUZZ_REQUIRE_AUTH_TOKEN true
[ -n "${BUZZ_IMAGE:-}" ] && set_kv BUZZ_IMAGE "$BUZZ_IMAGE"

echo "wrote $OUT (domain=$DOMAIN)"
```

- [ ] **Step 5: テスト用に relay 鍵生成を迂回して実行し、通ることを確認**

selftest は `BUZZ_RELAY_KEY_OVERRIDE` を設定していないため、Step 2 のテストは relay 鍵行に触れない（fixture の `BUZZ_RELAY_PRIVATE_KEY=CHANGE_ME_...` のままだと `docker run` を呼んでしまう）。テストを課金・Docker 非依存にするため、selftest の bootstrap 呼び出しに override を渡すよう Step 2 の 2 箇所を修正:

```bash
BUZZ_RELAY_KEY_OVERRIDE=deadbeef bash "$HERE/bootstrap-env.sh" "$FIX/env-example.env" "$OUT" 203.0.113.42 sslip.io aaaa1111 >/dev/null
# ...(pg1/relay1 取得)...
BUZZ_RELAY_KEY_OVERRIDE=deadbeef bash "$HERE/bootstrap-env.sh" "$FIX/env-example.env" "$OUT" 203.0.113.42 nip.io aaaa1111 >/dev/null
```

Run: `bash buzz/scripts/selftest.sh`
Expected: PASS（全 `ok`、特に `secret PRESERVED on re-run` / `relay key PRESERVED on re-run` / `domain REWRITTEN on re-run`、exit 0）

- [ ] **Step 6: shellcheck**

Run: `command -v shellcheck && shellcheck buzz/scripts/bootstrap-env.sh || echo "skipped"`
Expected: 警告なし or スキップ

- [ ] **Step 7: コミット**

```bash
git add buzz/scripts/bootstrap-env.sh buzz/scripts/selftest.sh buzz/tests/fixtures/env-example.env
git commit -m "feat(buzz): idempotent .env bootstrap (preserves secrets on re-run)"
```

---

## Task 4: `down.sh`（安全網を先に作る）

Phase B で課金 VM を作る前に、確実に壊せる手段を用意する。

**Files:**
- Create: `buzz/scripts/down.sh`

**Interfaces:**
- Consumes: `lib.sh`（`die`/`log`）
- Produces: `down.sh [SERVER_NAME]` — サーバ削除（ブートボリューム込み）+ SG + keypair を best-effort で破棄

- [ ] **Step 1: `down.sh` を実装**

`buzz/scripts/down.sh`:

```bash
#!/usr/bin/env bash
# 全 buzz-sample リソースを破棄。冪等（無ければ無視）。時間課金を止める安全網。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
SERVER="${1:-buzz-sample}"
SG="${SERVER}-sg"
KEY="${SERVER}-key"

log "deleting server ${SERVER} (with boot volume)..."
conoha server delete "$SERVER" --delete-boot-volume --yes 2>&1 | tail -1 || true

log "deleting security-group ${SG} (best-effort)..."
conoha network security-group delete "$SG" --yes 2>/dev/null || true

log "deleting keypair ${KEY} (best-effort)..."
conoha keypair delete "$KEY" --yes 2>/dev/null || true

log "remaining ${SERVER}* servers:"
conoha server list 2>/dev/null | grep -E "\b${SERVER}\b" || log "  (none)"
```

> **注:** サーバ削除は `--delete-boot-volume` 必須（memory: これが無いとブートボリュームが `available` で残りクォータを食う）。実フラグ名は Step 2 で確認する。

- [ ] **Step 2: フラグ名を実機ヘルプで検証（負の対照＝存在しないフラグは弾かれること）**

Run:
```bash
conoha server delete --help 2>&1 | grep -E "delete-boot-volume|--yes"
conoha network security-group delete --help 2>&1 | grep -E "yes|force"
```
Expected: `--delete-boot-volume` と `--yes` が実在する。**出なければ down.sh を実フラグ名に直す**（決め打ち禁止）。

- [ ] **Step 3: shellcheck + 構文チェック**

Run: `bash -n buzz/scripts/down.sh && (command -v shellcheck && shellcheck buzz/scripts/down.sh || echo skipped)`
Expected: 構文 OK、shellcheck 警告なし or スキップ

- [ ] **Step 4: コミット**

```bash
git add buzz/scripts/down.sh
git commit -m "feat(buzz): teardown script (deletes boot volume, idempotent)"
```

---

## Task 5: `up.sh`（リレー構築）— Phase B / 課金開始

**⚠️ 実 VPS が必要・時間課金発生。** 以降は人間が `conoha` 認証・SSH キーペア・Claude 資格情報を用意して実行し、原文ログを添付する。

**Files:**
- Create: `buzz/scripts/up.sh`

**Interfaces:**
- Consumes: `lib.sh`（`pubip`/`ip_to_dashes`/`load_ref`/`ssh_vm`/`die`/`log`）, `.buzz-ref`, `bootstrap-env.sh`
- Produces: 起動済みリレースタック。ローカル `buzz/.secrets/owner.nsec`（`0600`）と `owner.pub`。`buzz/.secrets/fqdn` に確定 FQDN を書く（verify.sh がローカル正本として読む）。

- [ ] **Step 1: `up.sh` を実装**

`buzz/scripts/up.sh`（spec §5.0 の 11 手順を反映）:

```bash
#!/usr/bin/env bash
# ConoHa VPS 1 台に Buzz リレーを立てる。冪等ではない（既存なら down.sh を先に）。
# 時間課金 → 使い終わったら必ず ./down.sh。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
load_ref
SERVER="${SERVER:-buzz-sample}"; SG="${SERVER}-sg"; KEY="${SERVER}-key"
FLAVOR="${FLAVOR:-g2l-t-c6m8}"
SECRETS="$HERE/../.secrets"; mkdir -p "$SECRETS"; chmod 700 "$SECRETS"

log "1. keypair / security-group..."
conoha keypair create "$KEY" 2>/dev/null || log "  keypair exists"
conoha network security-group create --name "$SG" --description "buzz sample" 2>/dev/null || log "  sg exists"
log "2. SG rules: 22 / 80 / 443..."
for p in 22 80 443; do
  conoha network security-group-rule create --security-group-id \
    "$(conoha network security-group show "$SG" --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')" \
    --direction ingress --ethertype IPv4 --protocol tcp --port-min "$p" --port-max "$p" --remote-ip 0.0.0.0/0 2>/dev/null || true
done

log "3. image 確認 + VM 作成 (課金開始)..."
IMAGE="${IMAGE:-ubuntu-26.04}"
conoha image list 2>/dev/null | grep -q "$IMAGE" || die "image $IMAGE not in catalog; run 'conoha image list'"
conoha server create --name "$SERVER" --flavor "$FLAVOR" --image "$IMAGE" \
  --key-name "$KEY" --security-group "$SG" --no-input --yes --wait

log "4. 公開 IPv4 抽出 (ローカル正本)..."
IP="$(conoha server show "$SERVER" --format json | pubip)"
[ -n "$IP" ] || die "no public IPv4 for $SERVER"
FQDN="$(ip_to_dashes "$IP").sslip.io"; printf '%s' "$FQDN" > "$SECRETS/fqdn"
log "   IP=$IP  FQDN=$FQDN"

log "5. SSH 準備 (ssh-keyscan — 版依存の --insecure に頼らない)..."
ssh-keygen -R "$IP" >/dev/null 2>&1 || true
until ssh-keyscan -H "$IP" >> ~/.ssh/known_hosts 2>/dev/null && ssh_vm "$IP" true 2>/dev/null; do
  log "   waiting for sshd..."; sleep 10
done

log "6. Docker 導入..."
ssh_vm "$IP" 'curl -fsSL https://get.docker.com | sh >/dev/null'
ssh_vm "$IP" 'docker compose version' | tee -a "$SECRETS/up.log"   # ≥ v2.24.4 必須

log "7. 上流取得 (完全 SHA で fetch)..."
ssh_vm "$IP" "rm -rf /opt/buzz && mkdir -p /opt/buzz && cd /opt/buzz && \
  git init -q && git remote add origin https://github.com/block/buzz.git && \
  git fetch --depth 1 -q origin $BUZZ_GIT_REF && git checkout -q FETCH_HEAD"

log "8. オーナー鍵 (無ければ 1 回だけ生成。回転させない)..."
if [ ! -f "$SECRETS/owner.pub" ]; then
  ssh_vm "$IP" "docker run --rm --entrypoint buzz-admin $BUZZ_IMAGE generate-key" > "$SECRETS/owner.raw"
  grep -oiE 'nsec1[0-9a-z]+' "$SECRETS/owner.raw" | head -1 > "$SECRETS/owner.nsec"
  grep -oiE '[0-9a-f]{64}'   "$SECRETS/owner.raw" | head -1 > "$SECRETS/owner.pub"
  rm -f "$SECRETS/owner.raw"; chmod 600 "$SECRETS/owner.nsec"
fi
OWNER_PUB="$(cat "$SECRETS/owner.pub")"
[ -n "$OWNER_PUB" ] || die "owner pubkey empty"
log "   owner pubkey=$OWNER_PUB (nsec kept local only, not logged)"

log "9. .env 生成 (VM 上, 冪等)..."
ssh_vm "$IP" "mkdir -p /opt/buzz/deploy/compose"
scp -q "$HERE/bootstrap-env.sh" "root@${IP}:/opt/buzz/scripts-bootstrap-env.sh"
ssh_vm "$IP" "cd /opt/buzz/deploy/compose && BUZZ_IMAGE=$BUZZ_IMAGE \
  bash /opt/buzz/scripts-bootstrap-env.sh .env.example .env $IP sslip.io $OWNER_PUB"

log "10. 起動 (TLS)..."
ssh_vm "$IP" 'cd /opt/buzz/deploy/compose && BUZZ_COMPOSE_TLS=true ./run.sh start' | tee -a "$SECRETS/up.log"

log "done. FQDN=$FQDN  次: ./verify.sh"
```

- [ ] **Step 2: 実行して起動まで到達**

Run: `cd buzz/scripts && ./up.sh 2>&1 | tee -a ../.secrets/up.log`
Expected: 手順 1–10 が通り、最後に `done. FQDN=<ip>.sslip.io`。手順 10 の `run.sh start` が `compose up -d --wait` で healthy まで待って戻る。

- [ ] **Step 3: 起動状態を目視確認**

Run: `ssh root@<IP> 'cd /opt/buzz/deploy/compose && docker compose ps'`
Expected: relay / postgres / redis / minio / caddy が `running`（relay は healthy）。

- [ ] **Step 4: コミット**

```bash
git add buzz/scripts/up.sh
git commit -m "feat(buzz): up.sh — provision VM, pin fetch, bootstrap, start relay"
```

---

## Task 6: `verify.sh`（リレー分）+ 実測

**Files:**
- Create: `buzz/scripts/verify.sh`

**Interfaces:**
- Consumes: `lib.sh`, `.secrets/fqdn`, `.secrets/owner.pub`, `.buzz-ref`
- Produces: 完了条件 0–4 の合否を原文で出力

- [ ] **Step 1: `verify.sh`（リレー分）を実装**

`buzz/scripts/verify.sh`:

```bash
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
IP="$(conoha server show "$SERVER" --format json | pubip)"
DC="cd /opt/buzz/deploy/compose && docker compose"
pass=0

echo "== 0. image↔source identity =="
SRC="$(ssh_vm "$IP" 'cd /opt/buzz && git rev-parse --short=7 HEAD')"
TAG="${BUZZ_IMAGE##*:sha-}"
[ "$SRC" = "$TAG" ] && echo "OK  src=$SRC == image=$TAG" || { echo "FAIL src=$SRC image=$TAG"; pass=1; }

echo "== 1. relay liveness (VM) =="
ssh_vm "$IP" "$DC exec -T relay sh -c 'curl -fsS http://127.0.0.1:8080/_liveness || curl -fsS http://127.0.0.1:3000/_liveness'" \
  && echo "OK liveness" || { echo "FAIL liveness"; pass=1; }

echo "== 2. external reachability (local) — NIP-11 JSON, NOT chat UI =="
curl -fsSI "https://${FQDN}/" | grep -iE 'content-type: application/json' \
  && echo "OK NIP-11 served" || { echo "FAIL / not JSON (tls internal ならこの行はスキップ理由を明記)"; pass=1; }

echo "== 3. WSS upgrade (local) =="
curl -fsS -i -N --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  "https://${FQDN}/" 2>&1 | grep -iE '101 Switching Protocols' \
  && echo "OK 101 (注: NIP-42 認証は別途 §7 項目 3 で確認)" || { echo "WARN no 101 via curl"; }

echo "== 4. owner registered (VM) =="
ssh_vm "$IP" "$DC exec -T relay buzz-admin list-members" | grep -qi "$OWNER_PUB" \
  && echo "OK owner in members ($OWNER_PUB)" || { echo "FAIL owner not in members"; pass=1; }

echo "== relay checks: $([ $pass = 0 ] && echo ALL PASS || echo HAS FAILURES) =="
exit "$pass"
```

> **注（spec §7 の警告を反映）:** 項目 2 は `tls internal` フォールバック時に証明書検証で落ちる。その場合は `curl -k` に切替え、「自己署名経路だった」ことをログに明記する（検証コマンドが変わる点を隠さない）。

- [ ] **Step 2: 実測（原文キャプチャ）**

Run: `cd buzz/scripts && ./verify.sh 2>&1 | tee -a ../.secrets/verify-relay.log`
Expected: 項目 0/1/2/4 が OK。3 は 101 が出れば OK（curl での WS 確認は環境依存のため WARN 許容、§7 項目 3 の NIP-42 は Task 8 で確認）。

- [ ] **Step 3: コミット**

```bash
git add buzz/scripts/verify.sh
git commit -m "feat(buzz): verify.sh relay checks (image==source, liveness, NIP-11, owner)"
```

---

## Task 7: `agent-up.sh`（ビルド → 鍵 → systemd）— Phase B

**Files:**
- Create: `buzz/scripts/agent-up.sh`

**Interfaces:**
- Consumes: 起動済みスタック（Task 5）, `.secrets/owner.pub`, `.buzz-ref`
- Produces: systemd サービス `buzz-acp`（`RESPOND_TO=allowlist`）, `/usr/local/bin/{buzz-acp,buzz}`, `.secrets/agent.pub`, オープンチャンネル 1 個の UUID を `.secrets/channel`

- [ ] **Step 1: `agent-up.sh` を実装**

`buzz/scripts/agent-up.sh`（spec §5.1 の 7 手順を反映）:

```bash
#!/usr/bin/env bash
# VM 上で buzz-acp/buzz をビルドし、エージェントを systemd 常駐させる。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
load_ref
SERVER="${SERVER:-buzz-sample}"
SECRETS="$HERE/../.secrets"
IP="$(conoha server show "$SERVER" --format json | pubip)"
FQDN="$(cat "$SECRETS/fqdn")"; OWNER_PUB="$(cat "$SECRETS/owner.pub")"
DC="cd /opt/buzz/deploy/compose && docker compose"

log "1. ビルド依存 + ツールチェーン..."
ssh_vm "$IP" 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  build-essential pkg-config libssl-dev cmake ca-certificates git nodejs npm >/dev/null'
ssh_vm "$IP" 'command -v cargo >/dev/null || (curl -fsSL https://sh.rustup.rs | sh -s -- -y >/dev/null)'
ssh_vm "$IP" 'df -h / && free -h' | tee -a "$SECRETS/agent.log"

log "2. buzz-acp / buzz をビルド (数十分。rust-toolchain.toml が 1.95.0 を固定)..."
ssh_vm "$IP" 'cd /opt/buzz && . "$HOME/.cargo/env" && cargo build --release --locked -p buzz-acp -p buzz-cli' \
  | tee -a "$SECRETS/agent.log"
ssh_vm "$IP" 'install -m755 /opt/buzz/target/release/buzz-acp /opt/buzz/target/release/buzz /usr/local/bin/'
ssh_vm "$IP" 'command -v buzz && buzz --help | head -1'   # 成果物名は buzz（buzz-cli ではない）

log "3. ACP アダプタ..."
ssh_vm "$IP" 'npm install -g @agentclientprotocol/claude-agent-acp >/dev/null 2>&1'

log "4. エージェント鍵 (スタック起動後なので exec 経由)..."
ssh_vm "$IP" "$DC exec -T relay buzz-admin generate-key" > "$SECRETS/agent.raw"
grep -oiE 'nsec1[0-9a-z]+' "$SECRETS/agent.raw" | head -1 > "$SECRETS/agent.nsec"
grep -oiE '[0-9a-f]{64}'   "$SECRETS/agent.raw" | head -1 > "$SECRETS/agent.pub"
rm -f "$SECRETS/agent.raw"; chmod 600 "$SECRETS/agent.nsec"
AGENT_PUB="$(cat "$SECRETS/agent.pub")"; AGENT_NSEC="$(cat "$SECRETS/agent.nsec")"
ssh_vm "$IP" "$DC exec -T relay buzz-admin add-member --pubkey $AGENT_PUB --role member"
log "   agent pubkey=$AGENT_PUB (nsec local only)"

log "5. Claude 認証 (O-1 サブスクリプション OAuth を先に試す)..."
cat <<EOF
────────────────────────────────────────────────────────────
[手動ステップ / spec §5.2] VM に SSH して claude ログインを試みてください:
    ssh -t root@$IP 'claude login'   # 表示 URL をローカルブラウザで開きコードを貼る
成功したら空 Enter。失敗するなら ANTHROPIC_API_KEY を入力（O-3 フォールバック）。
どちらで通したかは README と PR に必ず記録すること。
────────────────────────────────────────────────────────────
EOF
read -r -p "ANTHROPIC_API_KEY (OAuth 成功なら空 Enter): " APIKEY

log "6. systemd 登録 (RESPOND_TO=allowlist は必須。既定 owner-only は無言破棄)..."
ssh_vm "$IP" "cat > /etc/systemd/system/buzz-acp.service" <<UNIT
[Unit]
Description=Buzz ACP harness (Claude agent)
After=network-online.target
[Service]
Environment=BUZZ_PRIVATE_KEY=${AGENT_NSEC}
Environment=BUZZ_RELAY_URL=wss://${FQDN}
Environment=BUZZ_ACP_AGENT_COMMAND=claude-agent-acp
Environment=BUZZ_ACP_SUBSCRIBE=mentions
Environment=BUZZ_ACP_RESPOND_TO=allowlist
Environment=BUZZ_ACP_RESPOND_TO_ALLOWLIST=${OWNER_PUB}
$( [ -n "$APIKEY" ] && echo "Environment=ANTHROPIC_API_KEY=${APIKEY}" )
ExecStart=/usr/local/bin/buzz-acp
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
ssh_vm "$IP" 'systemctl daemon-reload && systemctl enable --now buzz-acp'
sleep 5
ssh_vm "$IP" 'systemctl is-active buzz-acp && journalctl -u buzz-acp --no-pager -n 20' | tee -a "$SECRETS/agent.log"

log "7. オープンチャンネル作成 (エージェント鍵) → オーナー join..."
CH="$(ssh_vm "$IP" "BUZZ_PRIVATE_KEY=$AGENT_NSEC BUZZ_RELAY_URL=wss://${FQDN} \
  buzz channels create --name demo --type stream --visibility open --format json" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')"
[ -n "$CH" ] || die "channel create failed"
printf '%s' "$CH" > "$SECRETS/channel"
OWNER_NSEC="$(cat "$SECRETS/owner.nsec")"
ssh_vm "$IP" "BUZZ_PRIVATE_KEY=$OWNER_NSEC BUZZ_RELAY_URL=wss://${FQDN} buzz channels join $CH"
log "done. channel=$CH  次: ./verify.sh --agent"
```

> **注:** `buzz channels create` の正確なフラグ/JSON 出力キー（`id`）は実機の `buzz channels create --help` で確認してから確定する（spec §8.2, 上流ドキュメント陳腐化の前例あり）。`--visibility open` は必須（private だとオーナー self-join が known gap に阻まれる）。

- [ ] **Step 2: 実行してエージェント常駐まで到達**

Run: `cd buzz/scripts && ./agent-up.sh 2>&1 | tee -a ../.secrets/agent.log`
Expected: ビルド完走、`systemctl is-active buzz-acp` = `active`、ログに relay 接続成功、`channel=<uuid>`。

- [ ] **Step 3: コミット**

```bash
git add buzz/scripts/agent-up.sh
git commit -m "feat(buzz): agent-up.sh — build, agent key, systemd (allowlist gate)"
```

---

## Task 8: `verify.sh`（エージェント分）+ 偽陰性対照 — Phase B / 中核

**Files:**
- Modify: `buzz/scripts/verify.sh`（`--agent` サブモードを追加）

**Interfaces:**
- Consumes: `.secrets/{owner.nsec,agent.pub,channel,fqdn}`
- Produces: 完了条件 5/6/7/7-N の合否

- [ ] **Step 1: `--agent` 分を追記**

`verify.sh` の `exit "$pass"` の直前に、`if [ "${1:-}" = "--agent" ]; then ... fi` ブロックを追加:

```bash
if [ "${1:-}" = "--agent" ]; then
  AGENT_PUB="$(cat "$SECRETS/agent.pub")"; CH="$(cat "$SECRETS/channel")"
  OWNER_NSEC="$(cat "$SECRETS/owner.nsec")"
  RENV="BUZZ_PRIVATE_KEY=$OWNER_NSEC BUZZ_RELAY_URL=wss://${FQDN}"

  echo "== 5. agent registered (VM) =="
  ssh_vm "$IP" "$DC exec -T relay buzz-admin list-members" | grep -qi "$AGENT_PUB" \
    && echo "OK agent in members" || { echo "FAIL agent not in members"; pass=1; }

  echo "== 6. harness active + gate=allowlist (VM) =="
  ssh_vm "$IP" 'systemctl is-active buzz-acp' | grep -q active \
    && ssh_vm "$IP" 'systemctl show buzz-acp -p Environment' | grep -q 'BUZZ_ACP_RESPOND_TO=allowlist' \
    && echo "OK active + allowlist" || { echo "FAIL harness/gate"; pass=1; }

  # 7-N 偽陰性対照: mention 無し本文は「応答なし」であるべき（検証が失敗を検出できるか先に確認）
  echo "== 7-N. negative control (must NOT get token back) =="
  TOKN="NEG$(openssl rand -hex 3)"
  ssh_vm "$IP" "$RENV buzz messages send --channel $CH --content 'no mention here $TOKN'"
  sleep 30
  if ssh_vm "$IP" "$RENV buzz messages thread --channel $CH --format json" | grep -q "$TOKN.*reply\|reply.*$TOKN"; then
    echo "FAIL negative control got a reply — verification is not discriminating"; pass=1
  else
    echo "OK no reply to non-mention (control passes)"
  fi

  # 7 本検証: @mention + token → N 秒内に token を含む応答
  echo "== 7. agent replies to @mention (CORE) =="
  TOK="DEAD$(openssl rand -hex 3)"
  ssh_vm "$IP" "$RENV buzz messages send --channel $CH --content '@agent reply with token $TOK'"
  ok=1
  for i in $(seq 1 12); do
    if ssh_vm "$IP" "$RENV buzz messages thread --channel $CH --format json" | grep -q "$TOK"; then ok=0; break; fi
    sleep 10
  done
  [ "$ok" = 0 ] && echo "OK agent echoed token $TOK" || { echo "FAIL no reply containing $TOK in 120s"; pass=1; }
fi
```

> **注:** `buzz messages send` / `buzz messages thread` の正確なフラグ・JSON 形状・応答の格納場所は実機の `buzz messages --help` で確認して確定する。`@agent` のメンション記法（pubkey か表示名か）も実機で確認（spec §8.2）。トークン照合が「応答本文」を確実に見るよう grep 対象を調整する。

- [ ] **Step 2: 偽陰性対照 → 本検証の順で実測**

Run: `cd buzz/scripts && ./verify.sh --agent 2>&1 | tee -a ../.secrets/verify-agent.log`
Expected: `7-N` が **OK（応答なし）** → `7` が **OK（token エコー）**。7-N が「応答あり」で FAIL するなら検証が判別できていないので、メンション記法・grep 対象を直して再実行（本リポジトリ CLAUDE.md: 検証命令を陰性対照で先に検証する）。

- [ ] **Step 3: 資源実測を残す（完了条件 8）**

Run: `ssh root@<IP> 'df -h / && free -h && cd /opt/buzz/deploy/compose && docker compose stats --no-stream' 2>&1 | tee -a ../.secrets/verify-agent.log`
Expected: 8GB での実使用量とビルド後ディスクが記録される。

- [ ] **Step 4: コミット**

```bash
git add buzz/scripts/verify.sh
git commit -m "feat(buzz): verify.sh --agent with mandatory negative control (core criterion)"
```

---

## Task 9: 後始末の実測（完了条件 9）— Phase B

- [ ] **Step 1: 破棄して残存 0 を確認**

Run: `cd buzz/scripts && ./down.sh 2>&1 | tee -a ../.secrets/down.log`
Expected: server 削除（`--delete-boot-volume`）、SG/keypair 削除、`remaining buzz-sample* servers: (none)`。

- [ ] **Step 2: ボリューム残存も確認（負の対照）**

Run: `conoha volume list 2>&1 | grep -i buzz-sample || echo "no buzz-sample volumes"`
Expected: `no buzz-sample volumes`（ブートボリュームが残っていない）。実フラグ/コマンド名は `conoha volume list --help` で確認。

- [ ] **Step 3: 証拠ログをまとめてコミット（秘密除外を確認）**

```bash
# .secrets/ は .gitignore 済み。証拠は docs へ手動転記（秘密鍵を含めない）。
grep -rIl 'nsec1' buzz/.secrets/ 2>/dev/null && echo "WARNING: nsec present, do NOT commit these files"
git add -A && git commit -m "chore(buzz): phase B live-run complete (teardown verified, 0 residual)" --allow-empty
```
Expected: `nsec` を含むファイルは `.secrets/` 内のみ（git 追跡外）。コミットに秘密が入らない。

---

## Task 10: README.md（日本語）

**Files:**
- Create: `buzz/README.md`

- [ ] **Step 1: README を書く**

`buzz/README.md`（他サンプルの構成に合わせる。全セクション実内容で埋める）:

```markdown
# buzz — ConoHa VPS 上で Buzz（人間 + AI エージェント協働ワークスペース）をセルフホスト

[Buzz](https://github.com/block/buzz)（Block, Inc. / Apache-2.0）は、**人間と AI エージェントが同じ部屋（Nostr リレー）で作業する**セルフホスト型ワークスペースです。メッセージも git イベントもワークフローも、すべて署名済み Nostr イベントとして 1 本のログに載ります。

このサンプルは、ConoHa VPS 1 台に Buzz リレーを立て、**Claude エージェントを独自の Nostr 鍵を持つ参加者として常駐**させ、`buzz` CLI からの `@mention` に応答するところまでを実測で示します。

> **重要:** バンドルされる Web にチャット UI はありません（`/` は NIP-11 JSON / git ブラウザのみ）。**人間側の操作は `buzz` CLI** で行います。チャット GUI が要る場合は上流のデスクトップアプリ（Tauri）を使ってください。

## 推奨フレーバー

- **`g2l-t-c6m8`（6 vCPU / 8GB）**。リレー 5 コンテナに加え、`buzz-acp`/`buzz`（Rust）を VM 上でビルドするため 8GB を推奨。`-t-` は時間課金です。
- フレーバー名・イメージ名は時期により異なります。`conoha flavor list` / `conoha image list` で確認してください。

## 前提

- `conoha` CLI セットアップ済み（v0.8.0 で確認）。SSH キーペア登録済み。
- 手元に `git` / `bash` / `python3` / `openssl` / `curl`。
- SSH(22)/HTTP(80, ACME)/HTTPS(443) を開ける（`up.sh` が SG を作成）。
- Claude 資格情報（サブスクリプション OAuth もしくは `ANTHROPIC_API_KEY`）。

## クイックスタート

```bash
cd buzz
bash scripts/selftest.sh          # ① ローカル検証（課金なし）
./scripts/up.sh                    # ② VM 作成 + リレー起動（課金開始）
./scripts/verify.sh                # ③ リレー完了条件
./scripts/agent-up.sh              # ④ エージェントをビルド・常駐（数十分）
./scripts/verify.sh --agent        # ⑤ 偽陰性対照 → @mention 応答（中核）
./scripts/down.sh                  # ⑥ 全破棄（必ず実行 — 時間課金）
```

## 仕組み

- TLS は Caddy が `<ip-dashes>.sslip.io` + Let's Encrypt で終端（`conoha proxy` 不使用 = `conoha.yml` なし）。
- 上流 `deploy/compose/` を **固定コミット SHA** で取得しパッチしません（`.buzz-ref`）。差分は `.env` 生成のみ。
- オーナー秘密鍵は**ローカル `.secrets/owner.nsec` のみ**（サーバに置かない・ログに出さない）。
- エージェントの著者ゲートは `allowlist`（既定 `owner-only` は無言破棄のため）。

## トラブルシュート

- **`/` が JSON を返す**: 正常です。チャットは `buzz` CLI かデスクトップアプリで。
- **Let's Encrypt 429（`docker compose logs caddy`）**: `sslip.io` は共有ドメインで LE 週次上限に当たることがあります。`down -v` → `bootstrap-env.sh <ip> nip.io <owner.pub>` で**ドメインだけ**差し替えて再起動（秘密は保存されます）。それでも駄目なら `Caddyfile` を `tls internal` に。
- **エージェントが無反応**: `journalctl -u buzz-acp`。`BUZZ_ACP_RESPOND_TO=allowlist` と allowlist にオーナー pubkey が入っているか確認。
- **ビルドが OOM**: 8GB でも落ちるならリレーを一時停止してからビルド。
- **Claude 認証**: サブスクリプション OAuth は上流未文書（動くかは実測）。動かなければ `ANTHROPIC_API_KEY`。

## 参考

- [block/buzz](https://github.com/block/buzz) — 上流
- `deploy/compose/README.md`（上流）/ `crates/buzz-acp/README.md`（ACP。`mint-token` の記述は陳腐化）
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
```

- [ ] **Step 2: 実測値で README を更新**

Phase B で判明した実値（ビルド所要時間、8GB でのピークメモリ、Claude 認証がどちらで通ったか）を「仕組み」「トラブルシュート」に反映する。**推測で埋めない** — 実測ログ（`.secrets/*.log`）から転記。

- [ ] **Step 3: コミット**

```bash
git add buzz/README.md
git commit -m "docs(buzz): Japanese README with measured values"
```

---

## Task 11: ルート README への登録

**Files:**
- Modify: `README.md`（「サンプル一覧」表）

- [ ] **Step 1: 一覧表に行を追加**

`README.md` の「サンプル一覧」表（`slurm-rest-api` 行の近く）に追加:

```markdown
| [buzz](buzz/) | Buzz relay (Rust) + Postgres + Redis + MinIO + Caddy | 人間 + AI エージェント協働ワークスペース（Nostr リレー）をセルフホスト。Claude エージェントを常駐させ `@mention` 応答まで実測。`conoha.yml` なし（Caddy が 80/443 を直接終端） | g2l-t-c6m8 (8GB) |
```

- [ ] **Step 2: 列数・書式が既存行と一致するか確認**

Run: `grep -nE '^\| \[buzz\]' README.md && grep -c '|' <(grep -E '^\| \[buzz\]' README.md)`
Expected: 1 行がヒットし、パイプ数が既存行と同じ（列ズレなし）。

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: list buzz sample in top-level README"
```

---

## Self-Review

**1. Spec coverage（スペック各節 → タスク対応）:**
- §0.1 Web UI 誤り訂正 → Task 6 項目 2（JSON 期待）, Task 10 冒頭の注意書き
- §3.1 ピン + 機械照合 → Task 1, Task 6 項目 0
- §4.0 オーナー鍵 provenance → Task 5 手順 8, §4.1 冪等 .env → Task 3
- §5.0 リレー構築 → Task 5 / §5.1 エージェント → Task 7 / §5.2 OAuth O-1→O-3 → Task 7 手順 5
- §6 失敗処理（LE 429 原子的再ブートストラップ, restart→start, RESPOND_TO） → Task 3（冪等）, Task 7（gate）, Task 10（トラブルシュート）
- §7 完了条件 0–9 → Task 6（0/1/2/4）, Task 8（5/6/7/7-N/8）, Task 9（9）
- §8.2 実機仮定 → Phase B 各タスクの「注」で実機確認を明示
- 非目標（ブラウザチャット, 複数エージェント, デスクトップ導入）→ どのタスクも作らない（範囲通り）
- **ギャップ:** 無し。

**2. Placeholder scan:** 各コードステップは実コードで埋めた。`<40-HEX>`/`<7>`/`<IP>` は「実測で置換する外部値」であり、置換手順（Task 1 Step 1, Task 5 が動的取得）を明示済み。上流 CLI のフラグ確定を要する箇所（down/channels/messages/volume）は各タスクの「注」で `--help` 確認を必須化 — これは陳腐化した上流ドキュメントに対する意図的な実機確認であり、プレースホルダではない。

**3. Type consistency:** `pubip`（stdin→IP）, `ip_to_dashes`, `load_ref`（`BUZZ_GIT_REF`/`BUZZ_IMAGE`）, `ssh_vm` の名前と引数は Task 2 定義と Task 5/6/7/8 使用で一致。`.secrets/` のファイル名（`owner.nsec`/`owner.pub`/`agent.nsec`/`agent.pub`/`fqdn`/`channel`）は生成（Task 5/7）と消費（Task 6/8）で一致。`bootstrap-env.sh` の引数順（example, out, ip, suffix, owner_pub）は Task 3 定義・selftest・Task 5 手順 9 で一致。
