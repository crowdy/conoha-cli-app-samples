# Dokploy Sample Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `dokploy/` sample to `conoha-cli-app-samples` consisting of a thin ConoHa-specific wrapper around Dokploy's official installer plus a Japanese README that walks the reader from a fresh VPS to running Dokploy and deploying their first app (hello-world from this repo) via the dashboard.

**Architecture:** Two files (`dokploy/README.md` + `dokploy/install-on-conoha.sh`) plus a one-row addition to the root `README.md` sample table. No `compose.yml` — Dokploy requires Docker Swarm and is installed via `install.sh`. The wrapper pins `DOKPLOY_VERSION=v0.28.8`, sets a non-default Swarm address pool to avoid CIDR collisions, pre-checks ports 80/443/3000, then delegates to the upstream installer.

**Tech Stack:** Bash (the wrapper script), Markdown (Japanese, README), Dokploy v0.28.8 (which itself bundles Traefik + Postgres 16 + Redis 7 on Docker Swarm).

**Spec:** `docs/superpowers/specs/2026-04-09-dokploy-sample-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `dokploy/install-on-conoha.sh` | Create | Bash wrapper around upstream `install.sh`. Adds root check, port pre-check, pinned version, and ConoHa-friendly Swarm address pool. ~80 lines. |
| `dokploy/README.md` | Create | Japanese documentation. Sections: notice / tech stack / architecture / prerequisites / deploy / verification / hello-world walkthrough / templates tip / production notes / uninstall / troubleshooting / links. Target ~250 lines. |
| `README.md` (root) | Modify | Add one row to the sample table, inserted right after the `coolify` row. |

No other files are touched.

---

## Task 1: Create install-on-conoha.sh

**Files:**
- Create: `dokploy/install-on-conoha.sh`

- [ ] **Step 1: Create the script with verbatim contents**

Create `dokploy/install-on-conoha.sh` with exactly the following content. Make it executable (`chmod +x`) after creation.

```bash
#!/bin/bash
#
# install-on-conoha.sh — install Dokploy on a ConoHa VPS3 instance.
#
# Thin wrapper around the upstream installer (https://dokploy.com/install.sh)
# that adds value specific to ConoHa VPS or to reproducibility:
#
#   - Root check and port 80/443/3000 pre-check (fail fast on conflicts)
#   - Pinned DOKPLOY_VERSION for reproducibility (override via env var)
#   - DOCKER_SWARM_INIT_ARGS default that avoids 10.0.0.0/24 to leave room
#     around future ConoHa private networks
#
# Usage (recommended — run inside the ConoHa VPS via `conoha server ssh`):
#
#   curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
#     | sudo bash
#
# Usage (with a custom Dokploy version):
#
#   export DOKPLOY_VERSION=v0.28.8
#   curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
#     | sudo -E bash
#

set -euo pipefail

# ----------------------------------------------------------------------------
# Pinned defaults — bump these single lines to upgrade.
# Both can be overridden by exporting the matching env var before running.
# ----------------------------------------------------------------------------

DEFAULT_DOKPLOY_VERSION="v0.28.8"
DOKPLOY_VERSION="${DOKPLOY_VERSION:-$DEFAULT_DOKPLOY_VERSION}"

DEFAULT_SWARM_INIT_ARGS="--default-addr-pool 10.20.0.0/16 --default-addr-pool-mask-length 24"
DOCKER_SWARM_INIT_ARGS="${DOCKER_SWARM_INIT_ARGS:-$DEFAULT_SWARM_INIT_ARGS}"

# ----------------------------------------------------------------------------
# Pre-flight checks
# ----------------------------------------------------------------------------

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "Error: this script must be run as root (try: sudo bash install-on-conoha.sh)" >&2
        exit 1
    fi
}

require_free_ports() {
    local conflicts=()
    local port
    for port in 80 443 3000; do
        if ss -tulnH 2>/dev/null | awk '{print $5}' | grep -Eq ":${port}$"; then
            conflicts+=("${port}")
        fi
    done
    if [ "${#conflicts[@]}" -gt 0 ]; then
        echo "Error: the following port(s) are already in use: ${conflicts[*]}" >&2
        echo "Dokploy needs ports 80, 443, and 3000 to be free." >&2
        echo "Stop the conflicting service(s) and retry." >&2
        exit 1
    fi
}

# ----------------------------------------------------------------------------
# Install + post-install
# ----------------------------------------------------------------------------

run_upstream_installer() {
    echo "Installing Dokploy ${DOKPLOY_VERSION} via upstream install.sh ..."
    echo "Swarm init args: ${DOCKER_SWARM_INIT_ARGS}"
    export DOKPLOY_VERSION
    export DOCKER_SWARM_INIT_ARGS
    curl -fsSL https://dokploy.com/install.sh | bash
}

print_next_steps() {
    local public_ip
    public_ip="$(curl -4fsS --connect-timeout 5 https://ifconfig.io 2>/dev/null || echo '<server-ip>')"
    cat <<EOF

==============================================================
Dokploy installation complete.

Next steps:
  1. Open the dashboard:  http://${public_ip}:3000
  2. Create the initial admin user on first visit.
  3. Follow the README walkthrough to deploy your first app
     (hello-world from this repo) via the dashboard.
==============================================================
EOF
}

main() {
    require_root
    require_free_ports
    run_upstream_installer
    print_next_steps
}

main "$@"
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x dokploy/install-on-conoha.sh`

- [ ] **Step 3: Verify bash syntax**

Run: `bash -n dokploy/install-on-conoha.sh`
Expected: no output, exit code 0.

- [ ] **Step 4: Run shellcheck if available**

Run: `command -v shellcheck >/dev/null && shellcheck dokploy/install-on-conoha.sh || echo "shellcheck not installed, skipping"`
Expected: either "shellcheck not installed, skipping" OR shellcheck reports zero issues. If shellcheck reports any warnings, fix them inline before continuing — typical fixes are quoting expansions and replacing `${var}` interpolations inside `[ ]` tests with `"${var}"`.

- [ ] **Step 5: Sanity-check the help paths exist by reading the file**

Read the file you just wrote and confirm:
- The shebang is `#!/bin/bash`
- `set -euo pipefail` is on its own line near the top
- `DEFAULT_DOKPLOY_VERSION="v0.28.8"` matches the pinned release
- `main "$@"` is the last line

- [ ] **Step 6: Commit**

```bash
git add dokploy/install-on-conoha.sh
git commit -m "feat(dokploy): add ConoHa wrapper for Dokploy install.sh

Thin bash wrapper around Dokploy's official installer that pre-checks
root + ports 80/443/3000, pins DOKPLOY_VERSION=v0.28.8 for
reproducibility, and sets a non-default Swarm address pool
(10.20.0.0/16) to leave room around future ConoHa private networks.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create dokploy/README.md

**Files:**
- Create: `dokploy/README.md`

The README is in Japanese, follows the same tone and section ordering as `gitea/README.md` and `coolify/README.md`. Below is the full content. Write it verbatim — it has been pre-composed to match the spec.

- [ ] **Step 1: Create dokploy/README.md with the following content**

````markdown
# dokploy

[Dokploy](https://dokploy.com/) を ConoHa VPS3 上にインストールするサンプルです。Dokploy は Heroku / Vercel / Netlify のオープンソース代替となるセルフホスティング PaaS で、VPS 一台で自分だけのデプロイ基盤を構築できます。

## ⚠️ このサンプルの特殊性

> **このサンプルは他のサンプルと違い、`conoha app deploy` を使いません。**
>
> Dokploy 自体が PaaS コントローラであり、内部で Docker Swarm を必須としています。公式 `install.sh` が Swarm 初期化、overlay ネットワーク作成、Swarm secret の生成、4 つのサービス起動を一括で行うため、`docker compose up` だけで再現するのは現実的ではありません。
>
> このサンプルでは公式インストーラを ConoHa 向けに薄くラップした `install-on-conoha.sh` を提供します。

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| PaaS コントローラ | Dokploy | v0.28.8 (固定) |
| リバースプロキシ | Traefik | v3.6.x (Dokploy が同梱) |
| データベース | PostgreSQL | 16 (Dokploy が同梱) |
| キャッシュ・キュー | Redis | 7 (Dokploy が同梱) |
| コンテナランタイム | Docker + Docker Swarm | 28.x (install.sh が導入) |

## アーキテクチャ

```
                          ┌──────────────────┐
              :80/:443    │  Traefik (host)  │
              ───────────▶│  dokploy-traefik │
                          └────────┬─────────┘
                                   │ overlay
                                   │ "dokploy-network"
              :3000                │
              ───────────▶┌────────┴─────────┐
                          │  Dokploy (svc)   │
                          │     :3000        │
                          └─┬──────────────┬─┘
                            │              │
                  ┌─────────▼──┐   ┌───────▼──────┐
                  │ postgres   │   │   redis      │
                  │ (svc) :5432│   │ (svc) :6379  │
                  └────────────┘   └──────────────┘

  すべて 1 台の Docker Swarm マネージャノード上で動作する
```

- **dokploy-traefik**: ホストモードで :80 / :443 を公開する Traefik (`docker run`)
- **dokploy**: メインのコントロールプレーン。Web UI を :3000 で公開 (`docker service`)
- **dokploy-postgres**: Dokploy 自身のメタデータ用 (`docker service`)
- **dokploy-redis**: Dokploy 自身のキュー用 (`docker service`)

## ディレクトリ構成

```
dokploy/
├── README.md             # このファイル
└── install-on-conoha.sh  # ConoHa 向けインストーラ (公式 install.sh の薄いラッパー)
```

`compose.yml` はありません。理由は冒頭の「このサンプルの特殊性」を参照してください。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キー設定済み
- **`g2l-t-4` (4GB) 以上推奨** — Dokploy 本体 + 同梱 Postgres/Redis/Traefik + 最初のアプリのビルドで概ね 2-3 GB を使う
- ConoHa Ubuntu 24.04 イメージ (`ss` などの `iproute2` コマンドが標準で利用可能)

## デプロイ

### 1. サーバーを作成

```bash
conoha server create \
  --name dokploy-host \
  --flavor g2l-t-4 \
  --image ubuntu-24.04 \
  --key mykey
```

### 2. サーバー内で install-on-conoha.sh を実行

`conoha server ssh` で接続して、ラッパースクリプトを root で実行します:

```bash
conoha server ssh dokploy-host

# 接続後（サーバー内で実行）
curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/dokploy/install-on-conoha.sh \
  | sudo bash
```

スクリプトは以下を行います:

1. root 権限と ports 80 / 443 / 3000 の空き状況を事前チェック
2. 環境変数 `DOKPLOY_VERSION` (デフォルト `v0.28.8`) と `DOCKER_SWARM_INIT_ARGS` を設定
3. 公式 `https://dokploy.com/install.sh` を呼び出す (Docker のインストール、Swarm init、4 サービス起動を全自動で実施)
4. 完了後にダッシュボード URL と次のステップを表示

### 代替: リポをクローンして実行

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/dokploy
sudo bash install-on-conoha.sh
```

### バージョンを変更したい場合

```bash
export DOKPLOY_VERSION=v0.28.8
curl -fsSL https://raw.githubusercontent.com/.../install-on-conoha.sh | sudo -E bash
```

## 動作確認

1. ブラウザで `http://<サーバーIP>:3000` にアクセス
2. 初回アクセス時に表示される画面で初期管理者アカウント (Email + Password) を作成
3. ダッシュボードが表示されれば成功

## 🎯 はじめてのアプリデプロイ — hello-world ウォークスルー

このリポジトリの `hello-world` サンプルを Dokploy 経由でデプロイしてみます。これで「VPS 一台 + Dokploy = 自分だけの PaaS」のストーリーが完結します。

### 1. プロジェクトを作成

ダッシュボード上で **Create Project** → 名前を `demo` として作成します。

### 2. アプリケーションを追加

`demo` プロジェクトを開き、**Create Application** をクリックします。アプリケーション名は任意 (例: `hello-world`)。

### 3. ソースを設定

作成したアプリの設定画面で **Provider: Public Git** を選び、以下を入力します:

| 項目 | 値 |
|------|-----|
| Repository URL | `https://github.com/crowdy/conoha-cli-app-samples` |
| Branch | `main` |
| Build Path | `hello-world` |
| Build Type | `Dockerfile` |

> **モノレポのサブディレクトリ指定** が現バージョンの Dokploy で動かない場合は、リポをフォークして `hello-world/` だけを残したリポを Repository URL に指定してください。

### 4. ドメインを設定

**Domains** タブを開き、**Add Domain** をクリック。Dokploy が自動生成する `*.traefik.me` のホスト名 (例: `<random>.traefik.me`) を採用すると、外部 DNS なしでアクセスできます。

> `*.traefik.me` が解決しない場合は、サーバーの IP アドレスをホスト名にして、Dokploy が割り当てた内部ポートで直接アクセスする方法もあります。`Show Logs` で割り当てポートを確認できます。

### 5. デプロイ

**Deploy** ボタンをクリック。ビルドログがリアルタイムに流れ、`hello-world` の Dockerfile (nginx + 静的 HTML) がビルドされます。完了したらドメインをブラウザで開き、`Hello World` ページが表示されれば成功です。

### 6. 振り返り

ここまでで以下が動いています:

- ConoHa VPS 1 台
- その上で Dokploy 本体 + Traefik + 自動 HTTPS 基盤 + メタデータ DB
- さらにその上で `hello-world` アプリが Dokploy 経由でビルド・デプロイされ、Traefik 経由で公開

このリポジトリの他のサンプル (例: `vite-react`, `hono-drizzle-postgresql`) も同じ手順でデプロイできます。Build Path だけ変えてください。

## 💡 Tip: テンプレートマーケットプレース

Dokploy には Pocketbase / Plausible / Cal.com など人気の OSS をワンクリックでデプロイできるテンプレートが組み込まれています。**Templates** メニューから試してみてください。

## 本番運用のヒント

- **独自ドメイン + 自動 HTTPS**: ドメイン DNS の A レコードをサーバー IP に向けたうえで、Dokploy の Domain 設定で **HTTPS** と **Certificate Provider: Let's Encrypt** を選ぶだけで Traefik が自動取得・更新します
- **バックアップ**: Dokploy の **Settings** から `dokploy-postgres` ボリュームの定期バックアップを設定できます
- **バージョン固定**: `install-on-conoha.sh` の `DEFAULT_DOKPLOY_VERSION` を編集するか、環境変数 `DOKPLOY_VERSION` で明示的に固定してください。`latest` や `canary` は再現性を損ねるため非推奨です
- **アップグレード**: 既存ホストでは `curl -fsSL https://dokploy.com/install.sh | bash -s update` でメジャーバージョンを上げられます

## アンインストール

完全に元に戻したい場合は以下を順に実行します:

```bash
# Dokploy のサービスを削除
docker service rm dokploy dokploy-postgres dokploy-redis

# Traefik コンテナを削除
docker rm -f dokploy-traefik

# Swarm secret を削除
docker secret rm dokploy_postgres_password

# Overlay ネットワークを削除
docker network rm dokploy-network

# データボリュームを削除（永続データも消えます）
docker volume rm dokploy dokploy-postgres dokploy-redis

# Swarm モードを抜ける
docker swarm leave --force

# Dokploy の設定ディレクトリを削除
sudo rm -rf /etc/dokploy
```

## トラブルシューティング

### ポート競合で install-on-conoha.sh が落ちる

`install-on-conoha.sh` は :80 / :443 / :3000 のいずれかが既に使われていると即座に終了します。`ss -tulnp` で何が使っているか確認し、`systemctl stop` 等で止めてから再実行してください。

### Swarm overlay の CIDR が他のネットワークと衝突する

デフォルトでは `10.20.0.0/16` を Swarm overlay 用に確保しています。もしそれが既存のネットワーク (社内 VPN など) と衝突する場合は、環境変数で別の範囲を指定してください:

```bash
export DOCKER_SWARM_INIT_ARGS="--default-addr-pool 172.30.0.0/16 --default-addr-pool-mask-length 24"
sudo -E bash install-on-conoha.sh
```

### `/etc/dokploy` の権限が `chmod 777` なのは何故？

公式 `install.sh` がそのように作成します。Dokploy 本体および Traefik コンテナがそれぞれ非 root ユーザでこのディレクトリを読み書きするためです。本番運用時に懸念がある場合は、Dokploy のドキュメントを参照して所有者・モードを調整してください。

### 動作確認チェックリスト

- [ ] `conoha server create --flavor g2l-t-4 ...` が成功する
- [ ] `install-on-conoha.sh` がエラーなく完走する
- [ ] `http://<IP>:3000` で Dokploy のダッシュボードが見える
- [ ] 初期管理者アカウントを作成できる
- [ ] hello-world ウォークスルーで `Hello World` ページが表示される
- [ ] アンインストール手順で完全に元に戻る (`docker info | grep Swarm` が `inactive`)

## 関連リンク

- [Dokploy 公式サイト](https://dokploy.com/)
- [Dokploy ドキュメント](https://docs.dokploy.com/)
- [Dokploy GitHub](https://github.com/dokploy/dokploy)
- [conoha-cli](https://github.com/crowdy/conoha-cli)
````

- [ ] **Step 2: Verify the file structure**

Read the file back and confirm:
- It has a top-level `# dokploy` heading
- The notice block is the second section
- The hello-world walkthrough section exists with the `🎯` emoji header
- The uninstall section contains all 7 cleanup commands (service rm, container rm, secret rm, network rm, volume rm, swarm leave, rm -rf /etc/dokploy)

- [ ] **Step 3: Commit**

```bash
git add dokploy/README.md
git commit -m "docs(dokploy): add Japanese README with hello-world walkthrough

Documents installation via install-on-conoha.sh, verification, the
'first app deploy' walkthrough that uses this repo's hello-world via
Dokploy's Public Git source, production notes (custom domain, HTTPS,
backups), and a complete uninstall block that mirrors the upstream
installer's structure.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add dokploy row to root README.md

**Files:**
- Modify: `README.md` (the row right after `coolify`)

- [ ] **Step 1: Read the existing coolify row to confirm exact location**

Read `README.md` lines 60-68 to confirm the `coolify` row is present and locate the line right after it.

- [ ] **Step 2: Insert the dokploy row**

Insert the following row immediately after the `coolify` row:

```markdown
| [dokploy](dokploy/) | Dokploy + Traefik + PostgreSQL + Redis (Docker Swarm) | セルフホスティング PaaS（install.sh ベース） | g2l-t-4 (4GB) |
```

The exact `Edit` operation:
- old_string: the `coolify` row exactly as it appears (use the row that begins `| [coolify](coolify/)`)
- new_string: that same row, followed by a newline, followed by the new dokploy row above

- [ ] **Step 3: Verify with grep**

Run: `grep -n "dokploy" README.md`
Expected: at least one line showing the new row in the sample table.

Run: `grep -c "PaaS" README.md`
Expected: 2 (one for coolify, one for dokploy).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: register dokploy in the sample list

Adds the dokploy row right after coolify so PaaS-style samples are
grouped. Description column flags 'install.sh ベース' so readers know
this sample's workflow differs from every other entry in the table.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Final verification

**Files:** none (read-only checks)

- [ ] **Step 1: Confirm directory contents**

Run: `ls -la dokploy/`
Expected: exactly two files — `README.md` and `install-on-conoha.sh` (executable).

- [ ] **Step 2: Confirm script syntax**

Run: `bash -n dokploy/install-on-conoha.sh`
Expected: no output, exit code 0.

- [ ] **Step 3: Confirm pinned version is consistent across script and README**

Run: `grep -n "v0.28.8" dokploy/install-on-conoha.sh dokploy/README.md`
Expected: at least one match in each file. If the pinned version was bumped during implementation, both files must agree.

- [ ] **Step 4: Confirm no compose.yml was accidentally created**

Run: `ls dokploy/compose.yml 2>/dev/null && echo "FAIL: compose.yml should not exist" || echo "OK: no compose.yml"`
Expected: `OK: no compose.yml`.

- [ ] **Step 5: Confirm root README has the new row**

Run: `grep "\[dokploy\](dokploy/)" README.md`
Expected: the new row from Task 3.

- [ ] **Step 6: Confirm three commits on the branch**

Run: `git log --oneline main..HEAD`
Expected: three commits (feat script, docs README, docs root README).

- [ ] **Step 7: Hand off to user for manual VPS verification**

Print to the user:

> Implementation complete on `feat/dokploy-sample`. Three commits ready. To verify on a real VPS, run:
>
> ```bash
> conoha server create --name dokploy-host --flavor g2l-t-4 --image ubuntu-24.04 --key mykey
> conoha server ssh dokploy-host
> # then inside the VPS:
> curl -fsSL https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/feat/dokploy-sample/dokploy/install-on-conoha.sh | sudo bash
> ```
>
> Then walk through the README's "はじめてのアプリデプロイ" section to confirm the hello-world walkthrough works end-to-end. Once verified, open a PR.

---

## Notes for the implementer

- **No automated tests**: this repo does not have a test suite. Verification is bash syntax check + shellcheck (if installed) + manual VPS run by the user. Do not invent a test framework.
- **No pre-commit hooks** to worry about for this repo (verified: `git status` was clean at branch creation).
- **Branch is already created**: this plan executes on `feat/dokploy-sample`. Do not create another branch.
- **Spec-only edits already exist on this branch**: two prior commits add the spec doc. Do not touch them.
- **Do not modify other samples**: the spec is explicit that Dokploy-awareness is not propagated to other sample directories.
