# Buzz セルフホスト サンプル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ConoHa VPS 1 台に Buzz リレー（block/buzz）を立て、Claude エージェントを常駐させ、`buzz` CLI からの `@mention` に応答することを実測で示すサンプルを `buzz/` に作る。

**Architecture:** 上流 `deploy/compose/` を固定コミット SHA で取得し、パッチせずに使う。オーバーレイ（scripts + `.buzz-ref`）だけを本リポジトリが所有する。TLS は Caddy が sslip.io + Let's Encrypt で終端し、`conoha proxy` は使わない（`conoha.yml` なし）。人間側クライアントは `buzz` CLI（バンドル Web にチャット UI は無い）。エージェントはホスト上の systemd プロセス（`buzz-acp` + `claude-agent-acp`）。

**Tech Stack:** bash, python3（JSON パース）, Docker Compose v2, ConoHa CLI v0.8.0, Rust 1.95.0（VM 上ビルド）, Node.js LTS + npm, Nostr。

**親スペック:** `docs/superpowers/specs/2026-07-24-buzz-sample-design.md`（rev 3.1）。**plan-reviewer にはこのスペックパスを必ず添付すること。**

**改訂:** rev 4 — plan-reviewer 3 巡目（N1/N2/N3/N5/N7/N8 RESOLVED、N4/N6 PARTIAL→指摘A/B、任意C）を反映。詳細は末尾「plan-reviewer 指摘の反映」表。

## Global Constraints

スペックの全タスク共通制約。値はスペックから逐語コピー。

- **フレーバー:** `g2l-t-c6m8`（6 vCPU / 8GB, 時間課金）。VM 上で cargo build するため 4GB では不足（spec §3.2）。
- **上流ピン:** `.buzz-ref` に `BUZZ_GIT_REF`（40 桁完全コミット SHA）と `BUZZ_IMAGE`（`ghcr.io/block/buzz:sha-<7>`）。**イメージタグ → コミット SHA の順**で決める。リリース `v*` タグはイメージを発行しない（spec §3.1, `.github/workflows/docker.yml:11-20`）。
- **秘密の不変条件:** `.env` の秘密・リレー鍵・オーナー pubkey は再ブートストラップで**回転させない**（上流 `deploy/compose/run.sh:32` "must not rotate on restart"）。
- **オーナー秘密鍵:** ローカル `buzz/.secrets/owner.nsec`（`0600`）が正本。`tee` ログには決して出さない。**サーバ配置の可否は spec §4.0 と Task 7 の逸脱ノートに従い人間が決定**（既定経路ではテスト送信のため使い捨て VM に一時配置＝§4.0 からの意図的逸脱。厳密順守はローカル `buzz` ビルド）。**silent に §4.0 準拠と断定しない**（reviewer N2）。
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

**reviewer N6:** Phase B の各スクリプト（up.sh/verify.sh/agent-up.sh）は課金中に生成されるため、**実行の直前に必ず `bash buzz/scripts/selftest.sh` を回す**（selftest は `scripts/*.sh` 全部に `bash -n`＋`shellcheck` を掛けるので、その時点で存在する新スクリプトも課金 VM に触れる前に静的検査される）。各実行ステップの Run はこの前置を含む。

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
  - `ssh_vm CMD...` — `conoha server ssh "$SERVER" -- CMD`（**検証済み先例 `vcluster` と同じく key 自動検出**。raw `ssh root@ip` は使わない ← reviewer F2）。`SERVER` はグローバル。
  - `put_file LOCAL REMOTE` — `conoha server ssh "$SERVER" -- "cat > REMOTE" < LOCAL`（scp を避けキー不一致を回避）

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

# 検証済み先例（vcluster）と同じく conoha server ssh を使う（key 自動検出）。SERVER はグローバル。
ssh_vm()   { conoha server ssh "${SERVER:?SERVER unset}" -- "$@"; }
put_file() { conoha server ssh "${SERVER:?SERVER unset}" -- "cat > $2" < "$1"; }
```

- [ ] **Step 5: テストが通ることを確認**

Run: `bash buzz/scripts/selftest.sh`
Expected: PASS（`ok - pubip picks public v4` / `ok - pubip empty when no public` / `ok - ip_to_dashes`、exit 0）

- [ ] **Step 6: 静的検査ゲートを selftest に追加（reviewer F4 — 全スクリプトを課金前に検査）**

`selftest.sh` の `exit "$fail"` の直前に追記:

```bash
# --- 全スクリプトの静的検査（bash -n + shellcheck）。過金 VM の前にここで潰す ---
for s in "$HERE"/*.sh; do
  bash -n "$s" || { echo "FAIL - bash -n $s"; fail=1; }
done
if command -v shellcheck >/dev/null; then
  shellcheck -e SC1090,SC1091 "$HERE"/*.sh || { echo "FAIL - shellcheck"; fail=1; }
else
  echo "note - shellcheck not installed; bash -n only"
fi
```

- [ ] **Step 7: 実行して緑を確認**

Run: `bash buzz/scripts/selftest.sh`
Expected: 既存の `ok` に加え、`bash -n` が全 `.sh` で通る（この時点では lib.sh/selftest.sh のみ）。exit 0。

- [ ] **Step 8: コミット**

```bash
git add buzz/scripts/lib.sh buzz/scripts/selftest.sh buzz/tests/fixtures/server-show.json buzz/tests/fixtures/server-show-priv.json
git commit -m "feat(buzz): shared lib (conoha-ssh wrapper), tested pubip + static-check gate"
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
SOME_NEW_UPSTREAM_VAR=CHANGE_ME_RANDOM
```

> 最後の `SOME_NEW_UPSTREAM_VAR` は**既知リストに無い** CHANGE_ME 変数。reviewer N3 のとおり、これが無いと動的掃討ループ（bootstrap-env.sh）が selftest で一度も実行されず検証力ゼロになる。この行が掃討で埋まることを Step 2 で assert する。

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
# reviewer N3: 既知リスト外の CHANGE_ME が動的掃討で埋まったことを確認（掃討ループの実効テスト）
check "unlisted var swept"    "0" "$(grep -c '^SOME_NEW_UPSTREAM_VAR=CHANGE_ME' "$OUT")"
check "unlisted var has hex"  "1" "$(grep -Ec '^SOME_NEW_UPSTREAM_VAR=[0-9a-f]{64}$' "$OUT")"
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
```

> **注（reviewer F7）:** fixture は上流 `.env.example` の一部の写しだが、実 VM では clone 内の完全な `.env.example` を使う。上の掃討ループが目録に無い新規 `CHANGE_ME_*` も埋めるため、上流が変数を足しても `run.sh:29` の起動拒否を回避できる。selftest の "no CHANGE_ME remains" 検証がこの掃討も併せて確認する。

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

log "deleting server ${SERVER} (with boot volume)..."
conoha server delete "$SERVER" --delete-boot-volume --yes 2>&1 | tail -1 || true

log "deleting security-group ${SG} (best-effort)..."
conoha network security-group delete "$SG" --yes 2>/dev/null || true

# keypair は削除しない（reviewer N1）: up.sh は登録済み KEY_NAME を再利用し
# キーペアを作らないため、ここで消すと利用者の登録鍵を破壊する。
log "keypair は保持（up.sh は登録済みキーを再利用するため削除しない）"

log "remaining ${SERVER}* servers:"
conoha server list 2>/dev/null | grep -E "\b${SERVER}\b" || log "  (none)"
```

> **注:** サーバ削除は `--delete-boot-volume` 必須（memory: これが無いとブートボリュームが `available` で残りクォータを食う）。実フラグ名は Step 2 で確認する。keypair は **削除しない**（up.sh が作らないため。reviewer N1）。

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

**前提（Phase B・reviewer F2）:** `KEY_NAME` は **ConoHa に登録済みのキーペア名**（`conoha keypair list` で確認）。`up.sh` はキーペアを新規作成しない — 作成すると出力（秘密鍵）と `conoha server ssh` の自動検出がずれて SSH 不能になる（検証済み先例 `vcluster/scripts/00-provision.sh:12` と同じ方針）。

**Interfaces:**
- Consumes: `lib.sh`（`pubip`/`ip_to_dashes`/`load_ref`/`ssh_vm`/`put_file`/`die`/`log`）, `.buzz-ref`, `bootstrap-env.sh`, 環境変数 `KEY_NAME`（必須）
- Produces: 起動済みリレースタック。ローカル `buzz/.secrets/owner.nsec`（`0600`）と `owner.pub`。`buzz/.secrets/fqdn` に確定 FQDN。

- [ ] **Step 1: Phase A で conoha フラグを `--help` ゲート（reviewer F2/F11 — 過金前に確定）**

Run:
```bash
conoha network security-group create --help 2>&1 | grep -E '\--name|\--description'
conoha network security-group-rule create --help 2>&1 | grep -E '\--security-group-id|\--direction|\--ethertype|\--protocol|\--port-min|\--port-max|\--remote-ip'
conoha server create --help 2>&1 | grep -E '\--key-name|\--security-group|\--wait|\--no-input|\--yes'
conoha server ssh --help 2>&1 | grep -E 'command|identity'
```
Expected: 使用する全フラグが実在する。**`server create` に `--wait` が無ければ**、選例（`vcluster` L27–41）の「`server show` の status が ACTIVE になるまでポーリング」に置換する（決め打ち禁止）。

- [ ] **Step 2: `up.sh` を実装**

`buzz/scripts/up.sh`（spec §5.0 反映 + reviewer F2 で先例パターンに合わせる）:

```bash
#!/usr/bin/env bash
# ConoHa VPS 1 台に Buzz リレーを立てる。冪等ではない（既存なら down.sh を先に）。
# 時間課金 → 使い終わったら必ず ./down.sh。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/lib.sh"
load_ref
SERVER="${SERVER:-buzz-sample}"; SG="${SERVER}-sg"
KEY_NAME="${KEY_NAME:?set KEY_NAME to a registered keypair (conoha keypair list)}"
FLAVOR="${FLAVOR:-g2l-t-c6m8}"
SECRETS="$HERE/../.secrets"; mkdir -p "$SECRETS"; chmod 700 "$SECRETS"

log "1. security-group（keypair は登録済み $KEY_NAME を再利用。作成しない）..."
conoha network security-group create --name "$SG" --description "buzz sample" 2>/dev/null || log "  sg exists"
SGID="$(conoha network security-group show "$SG" --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"
[ -n "$SGID" ] || die "could not resolve SG id for $SG"

log "2. SG rules: 22 / 80 / 443（生成後に存在を検証。silent 失敗を許さない — spec §6）..."
for p in 22 80 443; do
  conoha network security-group-rule create --security-group-id "$SGID" \
    --direction ingress --ethertype IPv4 --protocol tcp --port-min "$p" --port-max "$p" --remote-ip 0.0.0.0/0 2>/dev/null \
    || log "  rule tcp/$p may already exist"
done
# 22/80/443 が実在することをアサート（無ければ中断）
RULES_JSON="$(conoha network security-group show "$SG" --format json)"
for p in 22 80 443; do
  echo "$RULES_JSON" | python3 -c 'import sys,json
d=json.load(sys.stdin); p=int(sys.argv[1])
rs=d.get("security_group_rules", d.get("rules", []))
ok=any(r.get("port_range_min")==p and (r.get("protocol") or "").lower()=="tcp" for r in rs)
sys.exit(0 if ok else 1)' "$p" || die "SG rule tcp/$p missing after create"
done

log "3. image 確認 + VM 作成 (課金開始)..."
IMAGE="${IMAGE:-ubuntu-26.04}"
conoha image list 2>/dev/null | grep -q "$IMAGE" || die "image $IMAGE not in catalog; run 'conoha image list'"
conoha server create --name "$SERVER" --flavor "$FLAVOR" --image "$IMAGE" \
  --key-name "$KEY_NAME" --security-group "$SG" --no-input --yes --wait

log "4. 公開 IPv4 抽出 (ローカル正本)..."
IP="$(conoha server show "$SERVER" --format json | pubip)"
[ -n "$IP" ] || die "no public IPv4 for $SERVER"
FQDN="$(ip_to_dashes "$IP").sslip.io"; printf '%s' "$FQDN" > "$SECRETS/fqdn"
log "   IP=$IP  FQDN=$FQDN"

log "5. SSH 準備（先例と同じ: keyscan → conoha server ssh で疎通ループ）..."
ssh-keygen -R "$IP" >/dev/null 2>&1 || true
ssh-keyscan -H "$IP" >> ~/.ssh/known_hosts 2>/dev/null || true
ok=0; for _ in $(seq 1 60); do if ssh_vm echo ok >/dev/null 2>&1; then ok=1; break; fi; sleep 5; done
[ "$ok" = 1 ] || die "SSH to $SERVER not reachable (check SG / port 22)"

log "6. Docker 導入..."
ssh_vm 'curl -fsSL https://get.docker.com | sh >/dev/null'
CV="$(ssh_vm 'docker compose version --short' 2>/dev/null || true)"
log "   docker compose version=$CV"
# ≥ v2.24.4 必須（compose.caddy.yml の !reset タグ）。満たさなければ中断（reviewer F11）
ssh_vm 'docker compose version --short | awk -F. "{ exit !(\$1>2 || (\$1==2 && (\$2>24 || (\$2==24 && \$3>=4)))) }"' \
  || die "docker compose >= v2.24.4 required (got $CV)"

log "7. 上流取得 (完全 SHA で fetch)..."
ssh_vm "rm -rf /opt/buzz && mkdir -p /opt/buzz && cd /opt/buzz && \
  git init -q && git remote add origin https://github.com/block/buzz.git && \
  git fetch --depth 1 -q origin $BUZZ_GIT_REF && git checkout -q FETCH_HEAD"

log "8. オーナー鍵 (無ければ 1 回だけ生成。回転させない。DB 不要 = 起動前でよい)..."
if [ ! -f "$SECRETS/owner.pub" ]; then
  ssh_vm "docker run --rm --entrypoint buzz-admin $BUZZ_IMAGE generate-key" > "$SECRETS/owner.raw"
  grep -oiE 'nsec1[0-9a-z]+' "$SECRETS/owner.raw" | head -1 > "$SECRETS/owner.nsec"
  grep -oiE '[0-9a-f]{64}'   "$SECRETS/owner.raw" | head -1 > "$SECRETS/owner.pub"
  rm -f "$SECRETS/owner.raw"; chmod 600 "$SECRETS/owner.nsec"
fi
OWNER_PUB="$(cat "$SECRETS/owner.pub")"
[ -n "$OWNER_PUB" ] || die "owner pubkey empty"
log "   owner pubkey=$OWNER_PUB (nsec kept local only, not logged)"

log "9. .env 生成 (VM 上, 冪等)..."
put_file "$HERE/bootstrap-env.sh" /opt/buzz/scripts-bootstrap-env.sh
ssh_vm "cd /opt/buzz/deploy/compose && BUZZ_IMAGE=$BUZZ_IMAGE \
  bash /opt/buzz/scripts-bootstrap-env.sh .env.example .env $IP sslip.io $OWNER_PUB"

log "10. 起動 (TLS)..."
ssh_vm 'cd /opt/buzz/deploy/compose && BUZZ_COMPOSE_TLS=true ./run.sh start' | tee -a "$SECRETS/up.log"

log "done. FQDN=$FQDN  次: ./verify.sh"
```

> **冪等でない点（reviewer F11）:** 部分失敗時は `./down.sh` で全破棄してから再実行する（再過金）。`SERVER` が既存だと手順 3 で失敗する。

- [ ] **Step 3: 実行して起動まで到達**

Run: `cd buzz/scripts && bash selftest.sh && KEY_NAME=<登録済みキー名> ./up.sh 2>&1 | tee -a ../.secrets/up.log`
（selftest は全 `.sh` を静的検査。緑でなければ課金 VM を作らない — reviewer N6）
Expected: 手順 1–10 が通り、`done. FQDN=<ip>.sslip.io`。手順 10 の `run.sh start` が `compose up -d --wait` で healthy まで待って戻る。

- [ ] **Step 4: 起動状態を目視確認**

Run: `conoha server ssh buzz-sample -- 'cd /opt/buzz/deploy/compose && docker compose ps'`
Expected: relay / postgres / redis / minio / caddy が `running`（relay は healthy）。

- [ ] **Step 5: コミット**

```bash
git add buzz/scripts/up.sh
git commit -m "feat(buzz): up.sh — reuse registered keypair, conoha-ssh, asserted SG rules"
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
DC="cd /opt/buzz/deploy/compose && docker compose"
CURL_K="${CURL_K:-}"   # tls internal フォールバック時は CURL_K=-k を渡す（自己署名経路の明示）
pass=0

echo "== 0. image↔source identity =="
SRC="$(ssh_vm 'cd /opt/buzz && git rev-parse --short=7 HEAD')"
TAG="${BUZZ_IMAGE##*:sha-}"
[ "$SRC" = "$TAG" ] && echo "OK  src=$SRC == image=$TAG" || { echo "FAIL src=$SRC image=$TAG"; pass=1; }

echo "== 1. relay liveness (VM, 3000/8080 両方に存在) =="
ssh_vm "$DC exec -T relay sh -c 'curl -fsS http://127.0.0.1:8080/_liveness || curl -fsS http://127.0.0.1:3000/_liveness'" \
  && echo "OK liveness" || { echo "FAIL liveness"; pass=1; }

echo "== 2. external reachability (local) — NIP-11 (nostr+json), NOT chat UI =="
# router.rs:275 は Accept: application/nostr+json のとき NIP-11 を返す。content-type も nostr+json。
CT="$(curl -fsS $CURL_K -H 'Accept: application/nostr+json' -o /dev/null -w '%{content_type}' "https://${FQDN}/")"
echo "   content-type=$CT ($([ -n "$CURL_K" ] && echo 'self-signed path (tls internal)' || echo 'LE path'))"
printf '%s' "$CT" | grep -qiE 'application/nostr\+json' \
  && echo "OK NIP-11 served (nostr+json)" || { echo "FAIL / not nostr+json"; pass=1; }

echo "== 3. WSS + NIP-42 (local) =="
# curl の 101 は「認証前」の upgrade にすぎない（spec §7: 全拒否リレーでも 101）。
# NIP-42 の実証はエージェント応答（Task 8 項目 7）が担う。ここは 101 の有無のみ参考出力。
curl -fsS $CURL_K -i -N --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  "https://${FQDN}/" 2>&1 | grep -qiE '101 Switching Protocols' \
  && echo "OK 101 upgrade (NIP-42 の実証は Task 8 項目 7)" || echo "WARN no 101 via curl (NIP-42 は Task 8 で判定)"

echo "== 4. owner registered (VM, bootstrap_owner による自動登録) =="
# 起動時 bootstrap_owner が RELAY_OWNER_PUBKEY をメンバー登録する（relay-main.rs:294）。add-member 不要。
ssh_vm "$DC exec -T relay buzz-admin list-members" | grep -qi "$OWNER_PUB" \
  && echo "OK owner in members ($OWNER_PUB)" || { echo "FAIL owner not in members"; pass=1; }

echo "== relay checks: $([ $pass = 0 ] && echo ALL PASS || echo HAS FAILURES) =="
exit "$pass"
```

> **注（spec §7 / reviewer F5・F8）:**
> - 項目 2 の content-type は `application/nostr+json`（`router.rs:275`）。`application/json` では**マッチしない**。`tls internal` フォールバック時は `CURL_K=-k` を渡し、「自己署名経路だった」ことを出力に残す。
> - 項目 3 の curl-101 は認証前の upgrade にすぎず、NIP-42 の成否は示さない。**NIP-42 の実証は Task 8 項目 7（エージェント応答）に一本化**する（それが実際に署名付きイベントの往復を通すため）。

- [ ] **Step 2: 実測（原文キャプチャ）**

Run: `cd buzz/scripts && bash selftest.sh && ./verify.sh 2>&1 | tee -a ../.secrets/verify-relay.log`
Expected: 項目 0/1/2/4 が OK。3 は 101 が出れば参考 OK（NIP-42 は Task 8 で判定）。項目 2 が FAIL なら content-type を原文確認（`curl -v`）し、`nostr+json` 以外の実値なら grep を実値に合わせる（spec §8.2 の [仮定] 消し込み）。

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

> **秘密の扱い（reviewer/Global Constraint）:** nsec を `ssh_vm "... BUZZ_PRIVATE_KEY=$NSEC buzz ..."` のようにコマンド行へ置くと、VM の `ps` と**ローカルの tee ログの両方に平文で残る**。本タスクは nsec を **stdin パイプで VM の root-only env ファイルに書き**、`buzz` 呼び出しは `set -a; . <envfile>; set +a` で読む。コマンド行にもログにも nsec を出さない。
>
> **⚠️ spec §4.0 との緊張（人間の判断が要る点）:** 完了条件 7 は「**オーナー identity で @mention** → エージェント応答」を要する（allowlist=オーナー pubkey のため送信者はオーナーでなければならない）。オーナー nsec は §4.0 で「サーバに置かない」と定めたが、`buzz` はVM 上でビルドされるためオーナー送信を VM 上で行うにはオーナー nsec が一時的に VM に要る。**本プランは「使い捨て VM に root-only・ログ非出力で一時配置し、`down.sh` で VM ごと破棄」する経路を既定とする**が、これは §4.0 の文言からの意図的な逸脱である。厳密に §4.0 を守るなら「`buzz` をローカルにもビルドしオーナー送信をローカルから wss で行う」ことになる（ローカル Rust ツールチェーンが要る）。**どちらを採るかは実装着手前に人間へ確認する**（silent に緩めない）。以下は既定（VM 一時配置）経路で書く。

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
FQDN="$(cat "$SECRETS/fqdn")"; OWNER_PUB="$(cat "$SECRETS/owner.pub")"
DC="cd /opt/buzz/deploy/compose && docker compose"

log "1. ビルド依存 + ツールチェーン (spec §5.1: build-essential/pkg-config/libssl-dev/cmake)..."
ssh_vm 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  build-essential pkg-config libssl-dev cmake ca-certificates git nodejs npm >/dev/null'
ssh_vm 'command -v cargo >/dev/null || (curl -fsSL https://sh.rustup.rs | sh -s -- -y >/dev/null)'
ssh_vm 'df -h / && free -h' | tee -a "$SECRETS/agent.log"

log "2. buzz-acp / buzz をビルド (数十分。rust-toolchain.toml が 1.95.0 を固定)..."
ssh_vm 'cd /opt/buzz && . "$HOME/.cargo/env" && cargo build --release --locked -p buzz-acp -p buzz-cli' \
  | tee -a "$SECRETS/agent.log"
ssh_vm 'install -m755 /opt/buzz/target/release/buzz-acp /opt/buzz/target/release/buzz /usr/local/bin/'
ssh_vm 'command -v buzz && buzz --help | head -1'   # 成果物名は buzz（buzz-cli ではない）

log "3. ACP アダプタ + claude CLI (O-1 OAuth に必要。reviewer F6)..."
ssh_vm 'npm install -g @agentclientprotocol/claude-agent-acp @anthropic-ai/claude-code >/dev/null 2>&1'
ssh_vm 'command -v claude && command -v claude-agent-acp' | tee -a "$SECRETS/agent.log"

log "4. エージェント鍵 (スタック起動後なので exec 経由。generate-key は DB 不要だが exec で統一)..."
ssh_vm "$DC exec -T relay buzz-admin generate-key" > "$SECRETS/agent.raw"
grep -oiE 'nsec1[0-9a-z]+' "$SECRETS/agent.raw" | head -1 > "$SECRETS/agent.nsec"
grep -oiE '[0-9a-f]{64}'   "$SECRETS/agent.raw" | head -1 > "$SECRETS/agent.pub"
rm -f "$SECRETS/agent.raw"; chmod 600 "$SECRETS/agent.nsec"
AGENT_PUB="$(cat "$SECRETS/agent.pub")"
[ -n "$AGENT_PUB" ] || die "agent pubkey empty"
ssh_vm "$DC exec -T relay buzz-admin add-member --pubkey $AGENT_PUB --role member"
log "   agent pubkey=$AGENT_PUB (nsec local only, not logged)"

log "5. nsec を VM root-only env へ stdin で配置（コマンド行にもログにも出さない）..."
# エージェント nsec（systemd と CLI 用）
printf 'BUZZ_PRIVATE_KEY=%s\nBUZZ_RELAY_URL=wss://%s\n' "$(cat "$SECRETS/agent.nsec")" "$FQDN" \
  | ssh_vm 'umask 077; cat > /root/.buzz-agent.env'
# オーナー nsec（テスト送信用。§4.0 逸脱 — VM 破棄で消える。上の緊張ノート参照）
printf 'BUZZ_PRIVATE_KEY=%s\nBUZZ_RELAY_URL=wss://%s\n' "$(cat "$SECRETS/owner.nsec")" "$FQDN" \
  | ssh_vm 'umask 077; cat > /root/.buzz-owner.env'

log "6. Claude 認証 (O-1 サブスクリプション OAuth を先に。§5.2)..."
cat <<'EOF'
────────────────────────────────────────────────────────────
[手動ステップ / spec §5.2 O-1] 別端末で VM に入り claude ログインを試す:
    conoha server ssh buzz-sample          # PTY 付きシェル（key 自動検出）
    # シェル内で:  claude login            # 表示 URL をローカルブラウザで開きコード貼付
成功したら空 Enter。失敗するなら ANTHROPIC_API_KEY を入力（O-3 フォールバック）。
どちらで通したかを README と PR に必ず記録すること（silent に O-3 へ落ちない）。
────────────────────────────────────────────────────────────
EOF
read -r -p "ANTHROPIC_API_KEY (OAuth 成功なら空 Enter): " APIKEY

log "7. systemd 登録 (RESPOND_TO=allowlist 必須。既定 owner-only は無言破棄。HOME=/root で OAuth 資格を参照)..."
{
  printf '[Unit]\nDescription=Buzz ACP harness (Claude agent)\nAfter=network-online.target\n\n'
  printf '[Service]\n'
  printf 'EnvironmentFile=/root/.buzz-agent.env\n'          # BUZZ_PRIVATE_KEY / BUZZ_RELAY_URL
  printf 'Environment=HOME=/root\n'                          # claude OAuth 資格の探索先（reviewer F6）
  printf 'Environment=BUZZ_ACP_AGENT_COMMAND=claude-agent-acp\n'
  printf 'Environment=BUZZ_ACP_SUBSCRIBE=mentions\n'
  printf 'Environment=BUZZ_ACP_RESPOND_TO=allowlist\n'
  printf 'Environment=BUZZ_ACP_RESPOND_TO_ALLOWLIST=%s\n' "$OWNER_PUB"
  [ -n "$APIKEY" ] && printf 'Environment=ANTHROPIC_API_KEY=%s\n' "$APIKEY"
  printf 'ExecStart=/usr/local/bin/buzz-acp\nRestart=on-failure\nRestartSec=5\n\n'
  printf '[Install]\nWantedBy=multi-user.target\n'
} | ssh_vm 'umask 077; cat > /etc/systemd/system/buzz-acp.service'
ssh_vm 'systemctl daemon-reload && systemctl enable --now buzz-acp'
sleep 5
ssh_vm 'systemctl is-active buzz-acp && journalctl -u buzz-acp --no-pager -n 20' | tee -a "$SECRETS/agent.log"

log "8. オープンチャンネル作成 (エージェント鍵) → オーナー join..."
CH="$(ssh_vm 'set -a; . /root/.buzz-agent.env; set +a; buzz channels create --name demo --type stream --visibility open --format json' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')"
[ -n "$CH" ] || die "channel create failed"
printf '%s' "$CH" > "$SECRETS/channel"
ssh_vm "set -a; . /root/.buzz-owner.env; set +a; buzz channels join $CH"
log "done. channel=$CH  次: ./verify.sh --agent"
```

> **注（reviewer F6・spec §8.2）:** `claude-agent-acp` が OAuth を自前で扱うか `claude` CLI 資格を読むかは未確認 [仮定]。本プランは (a) `claude` CLI を入れ、(b) `HOME=/root` を渡し、(c) O-1 が動くかを**実測**する。動かなければ O-3（APIKEY）。この測定結果自体が spec の求める成果。
> **注:** `buzz channels create` / `channels join` の正確なフラグ・JSON キー（`id`）・`--visibility open` の要否は実機の `buzz channels create --help` で確認して確定（spec §8.2, 上流ドキュメント陳腐化の前例）。

- [ ] **Step 2: 実行してエージェント常駐まで到達**

Run: `cd buzz/scripts && bash selftest.sh && ./agent-up.sh 2>&1 | tee -a ../.secrets/agent.log`
（数十分のビルド前に静的検査 — reviewer N6）
Expected: ビルド完走、`claude` と `claude-agent-acp` が PATH に、`systemctl is-active buzz-acp` = `active`、ログに relay 接続成功、`channel=<uuid>`。ログに nsec が含まれないこと（`grep -c nsec1 ../.secrets/agent.log` = 0）。

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

**F1 の要点（reviewer）:** rev1 の検出は「オーナー自身が送った本文の `$TOK`」に必ずマッチし、エージェントが死んでいても PASS した。かつ 7 と 7-N で**別の grep**を使い、その非判別性を隠していた。修正:
1. 検出は「**作成者 pubkey == AGENT_PUB** かつ本文にトークン」を JSON でフィルタ（オーナー自身の投稿は除外）。
2. **7 と 7-N は完全に同一の検出関数**を使い、**ゲートだけを反転**（allowlist ↔ nobody）。7-N でエージェントを `nobody` に一時ミュートして「応答が来ないこと」を確認 → 検出関数が本物の応答だけを見ることを保証。
3. オーナー送信は `/root/.buzz-owner.env`（Task 7 で配置）を source し、nsec をコマンド行/ログに出さない。

- [ ] **Step 1: `--agent` 分を追記**

`verify.sh` の `exit "$pass"` の直前に追加:

```bash
if [ "${1:-}" = "--agent" ]; then
  AGENT_PUB="$(cat "$SECRETS/agent.pub")"; CH="$(cat "$SECRETS/channel")"

  echo "== 5. agent registered (VM) =="
  ssh_vm "$DC exec -T relay buzz-admin list-members" | grep -qi "$AGENT_PUB" \
    && echo "OK agent in members" || { echo "FAIL agent not in members"; pass=1; }

  echo "== 6. harness active + gate + drop counter (VM) =="
  ssh_vm 'systemctl is-active buzz-acp' | grep -q active \
    && ssh_vm 'systemctl show buzz-acp -p Environment' | grep -q 'BUZZ_ACP_RESPOND_TO=allowlist' \
    && echo "OK active + allowlist" || { echo "FAIL harness/gate"; pass=1; }
  echo "-- drop counter (spec §7 項目6) --"
  ssh_vm 'journalctl -u buzz-acp --no-pager | grep -ic drop || true'   # 破棄カウンタを原文で残す

  # 送信＝オーナー（/root/.buzz-owner.env, nsec 非ログ）。検出＝作成者 AGENT_PUB かつトークン包含。
  # 送信と検出を分離。7 と 7-N は同一の detect() を使い、送信本文だけ変える（ゲートは触らない）。
  send_owner() { # <content>
    ssh_vm "set -a; . /root/.buzz-owner.env; set +a; buzz messages send --channel $CH --content '$1'" >/dev/null
  }
  detect() {     # <token> → agent 作成の当該トークン投稿があれば 0
    ssh_vm "set -a; . /root/.buzz-owner.env; set +a; buzz messages thread --channel $CH --format json" \
      | python3 -c 'import sys,json
tok=sys.argv[1]; ap=sys.argv[2].lower()
d=json.load(sys.stdin)
msgs=d if isinstance(d,list) else d.get("messages",d.get("thread",[]))
def au(m): return (m.get("author") or m.get("pubkey") or m.get("author_pubkey") or "").lower()
def ct(m): return m.get("content") or m.get("text") or ""
sys.exit(0 if any(au(m)==ap and tok in ct(m) for m in msgs) else 1)' "$tok" "$AGENT_PUB"
  }
  poll_detect() { local i; for i in $(seq 1 12); do detect "$1" && return 0; sleep 10; done; return 1; }

  # 7-N 偽陰性対照（reviewer N5 の推奨 (a)）: @mention を含まない本文を送る。
  #   subscribe=mentions なのでエージェントには配信されず応答は発生しない。
  #   だが本文にはトークンを入れる → 著者フィルタが壊れた検出器はオーナー投稿に誤マッチして FAIL。
  #   ゲート反転も restart も再接続も伴わないため、検出器の判別力を最もクリーンに突く。
  echo "== 7-N. negative control: non-mention body must yield NO agent reply =="
  TOKN="NEG$(openssl rand -hex 3)"
  send_owner "no mention just a token $TOKN"
  if poll_detect "$TOKN"; then
    echo "FAIL negative control matched — detector is not discriminating (likely author filter broken)"; pass=1
  else
    echo "OK no agent reply to non-mention (detector discriminates)"
  fi

  # 7 本検証: 同一 detect でエージェント作成の応答を要求。成立＝閉リレーで NIP-42＋メンバーシップ通過を実証（reviewer F5）。
  echo "== 7. agent replies to @mention (CORE; also proves NIP-42) =="
  TOK="DEAD$(openssl rand -hex 3)"
  send_owner "@agent reply with token $TOK"
  if poll_detect "$TOK"; then
    echo "OK agent authored a reply containing the token"
  else
    echo "FAIL no agent-authored reply in 120s"; pass=1
  fi
fi
```

> **注（reviewer F1・F5・N5・spec §8.2）:**
> - 検出は**作成者 pubkey が AGENT_PUB** の投稿に限る。オーナー自身の投稿は除外されるため、rev1 の自己エコー誤判定は起きない。
> - 7-N は 7 と**同一の `detect()`** を使い、送信本文を「@mention 無し」に変える真の陰性対照。ゲート反転・restart・再接続を伴わないため誤診（enum 不正や再接続による false pass/fail）が起きない。7-N が「応答あり」になれば検出器が壊れている（著者フィルタの不具合。本リポジトリ CLAUDE.md 準拠）。
> - `buzz messages thread` の JSON 実形状（作成者キー名・メッセージ配列の場所）は実機の `buzz messages thread --help` と 1 回の実出力で確認し、`au()`/`ct()`/`msgs` のキー候補を実値に合わせる（spec §8.2 の [仮定] 消し込み。候補を複数持たせてあるが、実キーが違えば追加する）。
> - `@agent` のメンション記法（pubkey か表示名か）も実機で確認。7 が無反応で 7-N が正常なら、まず記法を疑う（検出器の判別力は 7-N で担保済み）。

- [ ] **Step 2: 陰性対照 → 本検証の順で実測**

Run: `cd buzz/scripts && bash selftest.sh && ./verify.sh --agent 2>&1 | tee -a ../.secrets/verify-agent.log`
（`--agent` 追記後の verify.sh を課金実行前に静的検査 — reviewer 指摘B）
Expected: `7-N` が **OK（non-mention に応答なし）** → `7` が **OK（エージェント作成の応答）**。7-N が FAIL したら: まず検出器がオーナー投稿に誤マッチ（著者フィルタのキー名）を疑い、**検出器単体が健全なら `subscribe=mentions` が実際に非 mention を配信していないか**を疑う（§8.2 の実機確認事項）。`grep -c nsec1 ../.secrets/verify-agent.log` = 0 を確認。

- [ ] **Step 3: 資源実測を残す（完了条件 8）**

Run: `conoha server ssh buzz-sample -- 'df -h / && free -h && cd /opt/buzz/deploy/compose && docker compose stats --no-stream' 2>&1 | tee -a ../.secrets/verify-agent.log`
Expected: 8GB での実使用量とビルド後ディスクが記録される。

- [ ] **Step 4: コミット**

```bash
git add buzz/scripts/verify.sh
git commit -m "feat(buzz): verify.sh --agent with mandatory negative control (core criterion)"
```

---

## Task 9: 後始末の実測（完了条件 9）— Phase B

- [ ] **Step 1: 破棄前にボリューム ID を記録（reviewer F10 — 名前依存を避ける）**

削除前に、サーバに紐づくブートボリューム ID を控える（削除後にその ID の不在で判定するため。名前 grep は自動命名のボリュームを取りこぼす）。

Run:
```bash
conoha volume list --help 2>&1 | grep -iE 'format|json'   # コマンド/フラグ実在を確認
# reviewer N4: Step 間はシェルが別なので env 変数でなくファイルへ保存する
conoha server show buzz-sample --format json | python3 -c 'import sys,json
d=json.load(sys.stdin)
vs=d.get("volumes_attached") or d.get("os-extended-volumes:volumes_attached") or []
ids=[v.get("id","") for v in vs if v.get("id")]
print("\n".join(ids))' | grep . > buzz/.secrets/volids || true   # 空行を残さない（reviewer 指摘A）
echo "boot volume id(s):"; cat buzz/.secrets/volids
```
Expected: `buzz/.secrets/volids` に 1 個以上のボリューム ID（空なら `server show` の実キー名を確認して合わせる。**空のまま進むと Step 3 が空振りするので、次の内容ガードが中断させる**）。

- [ ] **Step 2: 破棄して残存 0 を確認**

Run: `cd buzz/scripts && ./down.sh 2>&1 | tee -a ../.secrets/down.log`
Expected: server 削除（`--delete-boot-volume`）、SG/keypair 削除、`remaining buzz-sample* servers: (none)`。

- [ ] **Step 3: 記録した ID の不在で判定（負の対照）**

Run:
```bash
# 内容ガード（reviewer 指摘A）: [ -s ] は改行1バイトを非空と誤認するため、実トークンの有無で判定し exit で確実に止める
grep -q '[^[:space:]]' buzz/.secrets/volids || { echo "ABORT: no recorded volume ids (Step 1 空振り — server show の volume キー名を確認)"; exit 1; }
while read -r v; do
  [ -n "$v" ] || continue
  conoha volume list --format json | python3 -c 'import sys,json;print("\n".join(x.get("id","") for x in json.load(sys.stdin)))' \
    | grep -qx "$v" && { echo "FAIL volume $v still exists"; exit 1; } || echo "OK volume $v gone"
done < buzz/.secrets/volids
```
Expected: 記録した各 ID が `OK ... gone`。1 個でも残れば `--delete-boot-volume` が効いていない → loud に失敗。`volids` が空（無内容）なら ABORT で中断し Step 1 をやり直す（空振り PASS を防ぐ）。

- [ ] **Step 4: 証拠ログをまとめてコミット（秘密除外を確認）**

```bash
# .secrets/ は .gitignore 済み。証拠は docs へ手動転記（秘密鍵を含めない）。
grep -rIl 'nsec1' buzz/.secrets/ 2>/dev/null && echo "WARNING: nsec present, do NOT commit these files"
# 追跡対象に nsec が紛れていないことを最終ガード
git diff --cached --name-only | xargs -r grep -l 'nsec1' 2>/dev/null && { echo "ABORT: nsec in staged files"; false; } || true
git add -A && git commit -m "chore(buzz): phase B live-run complete (teardown verified, 0 residual)" --allow-empty
```
Expected: `nsec` を含むファイルは `.secrets/` 内のみ（git 追跡外）。ステージにも秘密が入らない。

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
- オーナー秘密鍵の正本は**ローカル `.secrets/owner.nsec`**（ログに出さない）。既定経路ではテスト送信のため使い捨て VM に一時配置し `down.sh` で破棄する（spec §4.0 からの意図的逸脱。厳密順守はローカル `buzz` ビルド）。※ Task 10 Step 2 で採用経路に応じてこの文言を実値へ更新すること。
- エージェントの著者ゲートは `allowlist`（既定 `owner-only` は無言破棄のため）。

## トラブルシュート

- **`/` が JSON を返す**: 正常です。チャットは `buzz` CLI かデスクトップアプリで。
- **Let's Encrypt 429（`docker compose logs caddy`）**: `sslip.io` は共有ドメインで LE 週次上限に当たることがあります。VM 上で原子的に再ブートストラップしてドメインだけ差し替えます（秘密・鍵は保存されます。spec §6）:

  ```bash
  IP=$(conoha server show buzz-sample --format json | python3 -c 'import sys,json;d=json.load(sys.stdin);print([a["addr"] for n in d["addresses"].values() for a in n if a.get("version")==4 and not a["addr"].startswith(("10.","127.","192.168."))][0])')
  OWNER_PUB=$(cat buzz/.secrets/owner.pub)
  conoha server ssh buzz-sample -- "cd /opt/buzz/deploy/compose && docker compose down -v && \
    BUZZ_IMAGE=$(sed -n 's/^BUZZ_IMAGE=//p' buzz/.buzz-ref) \
    bash /opt/buzz/scripts-bootstrap-env.sh .env.example .env $IP nip.io $OWNER_PUB && \
    BUZZ_COMPOSE_TLS=true ./run.sh start"
  # reviewer N8: ローカル正本も nip.io に更新（さもないと verify.sh が旧 sslip.io を叩き 404 誤診）
  printf '%s' "$(echo "$IP" | tr '.' '-').nip.io" > buzz/.secrets/fqdn
  ```

  `restart` ではなく `start`（`restart` は relay だけ再生成）。それでも駄目なら `Caddyfile` を `tls internal` に（verify は `CURL_K=-k` で自己署名経路を明示）。
- **エージェントが無反応**: `journalctl -u buzz-acp`。`BUZZ_ACP_RESPOND_TO=allowlist` と allowlist にオーナー pubkey が入っているか確認。
- **ビルドが OOM**: 8GB でも落ちるならリレーを一時停止してからビルド。
- **Claude 認証**: サブスクリプション OAuth は上流未文書（動くかは実測）。動かなければ `ANTHROPIC_API_KEY`。

## 参考

- [block/buzz](https://github.com/block/buzz) — 上流
- `deploy/compose/README.md`（上流）/ `crates/buzz-acp/README.md`（ACP。`mint-token` の記述は陳腐化）
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
```

- [ ] **Step 2: 実測値と採用経路で README を更新**

Phase B で判明した実値（ビルド所要時間、8GB でのピークメモリ、Claude 認証がどちらで通ったか）を「仕組み」「トラブルシュート」に反映する。**推測で埋めない** — 実測ログ（`.secrets/*.log`）から転記。

**§4.0 経路の文言を確定（reviewer N2）:** README「仕組み」のオーナー鍵行を、人間が選んだ経路の**実態に合わせる**。既定（VM 一時配置）なら「オーナー nsec の正本はローカル。テスト送信のため使い捨て VM に一時配置し down.sh で破棄（§4.0 からの意図的逸脱）」と正確に書く。「サーバに置かない」と断定したまま既定経路で走らせない（未確認を確認と書かない規約）。

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

## plan-reviewer 指摘の反映

### 3 巡目（N1/N2/N3/N5/N7/N8 = RESOLVED 判定。N4/N6 が PARTIAL だったため下記を追加修正）

| # | 判定 | 反映 |
|---|---|---|
| **指摘A** N4 の空ガードが `[ -s ]` で破れる（改行1バイトを非空と誤認 → 空振り PASS 再開通） | 修正 | Task 9: Step 1 の python を `| grep .` で空行除去、Step 3 ガードを `grep -q '[^[:space:]]'` 内容判定＋`exit 1`（`false` から強化） |
| **指摘B** N6 が Task 8 Step 2 を素通り（表は「5/6/7/8」と過大主張） | 修正 | Task 8 Step 2 の Run に `bash selftest.sh &&` 前置。これで表の主張と実体が一致 |
| **指摘C**（任意） 7-N FAIL 診断が subscribe=mentions 前提を織り込まず | 修正 | Task 8 Step 2 Expected に「検出器が健全なら subscribe=mentions 実挙動を疑え」を追記 |

### 2 巡目（新規 N1–N8。判定は全 F1–F11 + 秘密ログ = RESOLVED、F10 のみ PARTIAL→N4）

| # | 判定 | 反映 |
|---|---|---|
| **N1** down.sh が登録鍵を削除 | 修正 | keypair 削除を撤去（up.sh は作らない）。Task 4 |
| **N2** §4.0 自己矛盾 | 修正 | Global Constraints L22・README のオーナー鍵行に逸脱注記、Task 10 Step 2 で経路確定 |
| **N3** 掃討ループ無テスト | 修正 | fixture に既知リスト外 `SOME_NEW_UPSTREAM_VAR=CHANGE_ME` 追加＋埋まった assert（Task 3） |
| **N4** VOLID が Step 間で消える | 修正 | `.secrets/volids` に保存、Step 3 で読み込み、空なら中断（Task 9） |
| **N5** 7-N の nobody 依存が脆い | 修正 | 7-N を **@mention 無し本文**に変更（ゲート反転・restart 廃止）。同一 `detect()` 維持（Task 8） |
| **N6** Phase B 静的検査漏れ | 修正 | 各課金実行の Run に `bash selftest.sh &&` 前置（Task 5/6/7/8） |
| **N7** gen_secret が set -e で即死 | 修正 | grep パイプに `|| true`（Task 3） |
| **N8** 復旧で fqdn 未更新 | 修正 | README 429 復旧末尾で `.secrets/fqdn` を nip.io に更新 |

### 1 巡目（F1–F11 + 秘密ログ = 全 RESOLVED）

| # | 判定 | 反映 |
|---|---|---|
| **F1** 中核完了条件の偽 PASS | 修正 | Task 8: 検出を**作成者==AGENT_PUB**でフィルタ、7 と 7-N で**同一 `detect()`**、7-N は @mention 無し本文を送る真の陰性対照（reviewer N5 で nobody-toggle から変更） |
| **F2** up.sh の keypair/SG/SSH | 修正 | 登録済み `KEY_NAME:?` 再利用（作成しない）、全リモートを `conoha server ssh`（`ssh_vm`/`put_file`）、SG ルールを生成後にアサート、フラグを Phase A で `--help` ゲート |
| **F3** bootstrap 引数不一致 | 修正 | README 429 復旧を実 5 引数（`down -v`＋`start` 込み）に統一 |
| **F4** 静的検査ゲート欠如 | 修正 | selftest が全 `.sh` に `bash -n`＋`shellcheck`（Task 2 Step 6） |
| **F5** NIP-42 未検証 | 修正 | curl-101 は参考に降格、NIP-42 実証を Task 8 項目 7（エージェント作成の応答）へ一本化 |
| **F6** claude CLI 欠如 | 修正 | Task 7 で `@anthropic-ai/claude-code` も導入、systemd に `HOME=/root` |
| **F7** CHANGE_ME 掃討漏れ | 修正 | bootstrap-env.sh に残存 CHANGE_ME の動的掃討＋最終ガード |
| **F8** content-type 誤り | 修正 | `application/nostr+json` ＋ `Accept` ヘッダ、`tls internal` 用 `CURL_K=-k` |
| **F9** オーナー自動登録/破棄カウンタ | 修正 | 自動登録を `relay-main.rs:294` で**検証済み**と明記、Task 8 項目 6 に drop カウンタ捕捉 |
| **F10** ボリューム名依存 | 修正 | Task 9: 破棄前に**ボリューム ID を記録**し ID 不在で判定 |
| **F11** 雑多 | 修正 | compose 版数を**アサート**、`--wait` 不在時のポーリング代替を明記、非冪等/エージェント鍵再生成の注記 |
| 秘密のログ漏れ（Global Constraint） | 修正 | nsec を **stdin で VM root-only env に配置**、`buzz` は env source 経由。コマンド行/tee ログに出さない |

**人間の判断が要る残点（silent に決めない）:** Task 7 の「オーナー nsec を使い捨て VM に一時配置」は spec §4.0「サーバに置かない」からの意図的逸脱。厳密順守はローカル `buzz` ビルド。**着手前に人間へ確認**（Task 7 のノートに明記）。

## Self-Review

**1. Spec coverage（スペック各節 → タスク対応）:**
- §0.1 Web UI 誤り訂正 → Task 6 項目 2（nostr+json 期待）, Task 10 冒頭注意
- §3.1 ピン + 機械照合 → Task 1, Task 6 項目 0
- §4.0 オーナー鍵 provenance → Task 5 手順 8, §4.1 冪等 .env → Task 3
- §5.0 リレー構築 → Task 5 / §5.1 エージェント → Task 7 / §5.2 OAuth O-1→O-3 → Task 7 手順 6
- §6 失敗処理（LE 429 原子的再ブートストラップ, restart→start, RESPOND_TO） → Task 3（冪等）, Task 7（gate）, Task 10（トラブルシュート）
- §7 完了条件 0–9 → Task 6（0/1/2/3-参考/4）, Task 8（5/6/7/7-N + 資源8）, Task 9（9）
- §8.2 実機仮定 → Phase B 各タスクの「注」で実機確認を明示（content-type, messages/channels JSON キー, claude-agent-acp 認証, `--wait`, volume キー）
- Global Constraints（秘密不変・nsec 非ログ・allowlist・buzz バイナリ名・conoha.yml なし・証拠規約・陰性対照）→ 各タスクに反映
- 非目標（ブラウザチャット, 複数エージェント, デスクトップ導入）→ どのタスクも作らない（範囲通り）
- **ギャップ:** 実行前に閉じられない [仮定] は §8.2 と各「注」に集約済み。これらは実 VM の最初のステップで実値に消し込む前提であり、外れた場合は該当タスクを再検討する（reviewer の「限界」節と同旨）。

**2. Placeholder scan:** 各コードステップは実コードで埋めた。`<40-HEX>`/`<7>` は Task 1 Step 1 で実測置換、`<IP>` 等は実行時に動的取得。上流 CLI のフラグ/JSON キー確定を要する箇所は各タスクの「注」で `--help`＋1 回の実出力での確認を必須化（陳腐化した上流ドキュメントへの意図的な実機確認）。JSON パーサはキー候補を複数持たせ、外れたら追加する方針を明記。

**3. Type consistency:** `pubip`（stdin→IP）, `ip_to_dashes`, `load_ref`, `ssh_vm`（SERVER グローバル）, `put_file` の名前・引数は Task 2 定義と Task 5/6/7/8 使用で一致。`.secrets/` のファイル名（`owner.nsec`/`owner.pub`/`agent.nsec`/`agent.pub`/`fqdn`/`channel`）は生成（Task 5/7）と消費（Task 6/8）で一致。VM 側 `/root/.buzz-{agent,owner}.env` は Task 7 で生成し Task 8 で source。`bootstrap-env.sh` は 5 引数（example, out, ip, suffix, owner_pub）で Task 3 定義・selftest・Task 5 手順 9・Task 10 復旧で一致。
