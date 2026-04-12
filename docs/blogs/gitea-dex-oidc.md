---
title: conoha-cliでGitea + Dex（OIDC認証）をConoHa VPSにワンコマンドデプロイ
tags: gitea Docker Conoha OIDC conoha-cli
author: crowdy
slide: false
---
# はじめに

社内やチームにGitサーバーが欲しいけど、GitHubやGitLabほどの大規模なものは必要ない——そんなケースは意外と多いのではないでしょうか。

**結論から言えば、Gitea + Dex（OIDC認証）+ PostgreSQLの3サービス構成を、conoha-cliを使えば3コマンドでConoHa VPSにデプロイできます。**

Giteaを選ぶ理由は明確です。**人は見えるものに動機づけられます。** ビジュアルなリポジトリブラウザ、プルリクエスト、イシュートラッカーがあるだけで、チームの開発プロセスは大きく変わります。しかもGiteaは非常に軽量で、開発サーバーに気軽にインストールできるレベルです。

Dexも同様に超軽量なOIDCプロバイダーです。どのくらい軽量かというと、**ユーザー登録フォームすら存在しません。** LDAP、GitHub、Google等の外部IdPへの認証中継に特化しており、余計な機能がないぶん、セットアップもシンプルです。

さらにGiteaには公式CLI [tea](https://gitea.com/gitea/tea) があり、ターミナルからリポジトリ、イシュー、プルリクエストを操作できます。加えて**REST APIも完全にサポート**しているため、AIエージェント経由でラベル、マイルストーン、イシュー等を管理することも可能です。CI/CDには [act_runner](https://gitea.com/gitea/act_runner) によるGitea Actions（GitHub Actions互換）が利用でき、セルフホストでありながらモダンな開発ワークフローを実現できます。クラウド上のイシューやOrg設定はCLAUDE.mdで管理するレベルではないため、ローカル環境をリセットしても安心です（最近はローカルに開発ツールや環境が増えすぎて、リセットの機会も増えていますよね）。

---

# 構成の全体像

| コンポーネント | 役割 | イメージ |
|-------------|------|---------|
| **Gitea** | セルフホストGitサーバー（Web UI + SSH） | `gitea/gitea:latest` |
| **Dex** | OIDC認証プロバイダー | `dexidp/dex:v2.45.1` |
| **PostgreSQL** | データベース（Gitea用 + Dex用を共有） | `postgres:17-alpine` |

```
ブラウザ → :3000 → [Gitea] ──OIDC──→ :5556 → [Dex]
              │                              │
              │ postgres                     │ postgres
              ▼                              ▼
          [PostgreSQL 17] ← DB: gitea    DB: dex
              SSH: :2222
```

Giteaがメインの開発UI、DexがOIDC認証を中継し、PostgreSQL 1インスタンスで両者のデータベースをホストします。

---

# conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

- `conoha server create` でサーバーをワンコマンド作成
- `conoha app init` でDocker環境を自動セットアップ
- `conoha app deploy` でカレントディレクトリをそのままデプロイ（`compose.yml` を自動検出）
- `conoha app logs --follow` でログをストリーミング表示

`app deploy` は内部的に以下を実行します:
1. カレントディレクトリをアーカイブしてサーバーに転送
2. `docker compose up -d --build` でコンテナを起動
3. コンテナの状態を表示して完了

---

# 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

---

# ファイル構成

```
gitea/
├── compose.yml     # 3サービス定義（gitea, dex, db）
├── dex.yml         # Dex設定テンプレート（ストレージ、静的クライアント、テストユーザー）
├── init-db.sh      # PostgreSQL初期化スクリプト（gitea + dex DB作成）
└── README.md
```

---

# ハマりポイント

## 1. Dexの設定ファイルで環境変数が展開されない

Dexは設定ファイル（YAML）内の `$ENV_VAR` や `${ENV_VAR:-default}` を**自動展開しません。** Go言語の `os.ExpandEnv()` を使っているという情報もありますが、実際にはv2.45.1で動作確認したところ展開されませんでした。

**症状:**

OIDC Discovery エンドポイントの issuer がリテラルのまま返される。

```json
{
  "issuer": "http://$DEX_ISSUER_HOST:5556/dex"
}
```

**解決策:**

`dex.yml` にプレースホルダー（`__VAR__`）を使い、`compose.yml` の entrypoint で `sed` 置換する方式を採用しました。

```yaml
# dex.yml（テンプレート）
issuer: http://__DEX_ISSUER_HOST__:5556/dex
storage:
  type: postgres
  config:
    database: __DEX_DB_NAME__
    user: __DEX_DB_USER__
    password: __DEX_DB_PASSWORD__
```

```yaml
# compose.yml（entrypoint で sed 置換）
dex:
  image: dexidp/dex:v2.45.1
  entrypoint: ["sh", "-c"]
  command:
    - |
      sed \
        -e "s|__DEX_ISSUER_HOST__|$$DEX_ISSUER_HOST|g" \
        -e "s|__DEX_DB_NAME__|$$DEX_DB_NAME|g" \
        -e "s|__DEX_DB_USER__|$$DEX_DB_USER|g" \
        -e "s|__DEX_DB_PASSWORD__|$$DEX_DB_PASSWORD|g" \
        -e "s|__GITEA_OAUTH2_CLIENT_ID__|$$GITEA_OAUTH2_CLIENT_ID|g" \
        -e "s|__GITEA_OAUTH2_CLIENT_SECRET__|$$GITEA_OAUTH2_CLIENT_SECRET|g" \
        -e "s|__GITEA_HOST__|$$GITEA_HOST|g" \
        /etc/dex/dex.yml > /tmp/dex.yml &&
      exec dex serve /tmp/dex.yml
```

ポイントは `compose.yml` 内で `$$` を使うことです。Docker Compose は `$` をシェル変数展開として解釈するため、コンテナ内のシェルに `$` を渡すには `$$` とエスケープする必要があります。

## 2. PostgreSQL 1インスタンスで2つのデータベースを作成する

PostgreSQLの `POSTGRES_DB` 環境変数は1つのデータベースしか作成できません。Dex用のデータベースは `init-db.sh` を `/docker-entrypoint-initdb.d/` にマウントして初期化時に作成します。

```bash
#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE ${DEX_DB_NAME:-dex};
    CREATE USER ${DEX_DB_USER:-dex} WITH PASSWORD '${DEX_DB_PASSWORD:-dex}';
    GRANT ALL PRIVILEGES ON DATABASE ${DEX_DB_NAME:-dex} TO ${DEX_DB_USER:-dex};
    ALTER DATABASE ${DEX_DB_NAME:-dex} OWNER TO ${DEX_DB_USER:-dex};
EOSQL
```

**注意:** このスクリプトはPostgreSQLの**初回起動時のみ**実行されます。すでにデータボリュームが存在する場合は実行されないため、データベースを作り直したい場合は `docker volume rm` でボリュームを削除してください。

## 3. ポート競合に注意

同一サーバーで他のアプリが同じポートを使用していると、コンテナは起動するもののポートバインドに失敗し、**エラーメッセージが分かりにくい**場合があります。

```
Error: Bind for 0.0.0.0:3000 failed: port is already allocated
```

`docker ps` で全コンテナを確認し、競合するコンテナを停止してからデプロイしてください。

---

# compose.yml

```yaml
services:
  gitea:
    image: gitea/gitea:${GITEA_VERSION:-latest}
    ports:
      - "${GITEA_HTTP_PORT:-3000}:3000"
      - "${GITEA_SSH_PORT:-2222}:22"
    environment:
      - GITEA__database__DB_TYPE=postgres
      - GITEA__database__HOST=db:5432
      - GITEA__database__NAME=${GITEA_DB_NAME:-gitea}
      - GITEA__database__USER=${GITEA_DB_USER:-gitea}
      - GITEA__database__PASSWD=${GITEA_DB_PASSWORD:-gitea}
      - GITEA__service__DISABLE_REGISTRATION=${GITEA_DISABLE_REGISTRATION:-false}
      - GITEA__service__ALLOW_ONLY_EXTERNAL_REGISTRATION=${GITEA_ALLOW_ONLY_EXTERNAL:-false}
      - GITEA__openid__ENABLE_OPENID_SIGNIN=${GITEA_ENABLE_OPENID:-true}
      - GITEA__oauth2__ENABLED=${GITEA_OAUTH2_ENABLED:-true}
    volumes:
      - gitea_data:/data
    depends_on:
      db:
        condition: service_healthy
      dex:
        condition: service_healthy

  dex:
    image: dexidp/dex:${DEX_VERSION:-v2.45.1}
    entrypoint: ["sh", "-c"]
    command:
      - |
        sed \
          -e "s|__DEX_ISSUER_HOST__|$$DEX_ISSUER_HOST|g" \
          -e "s|__DEX_DB_NAME__|$$DEX_DB_NAME|g" \
          -e "s|__DEX_DB_USER__|$$DEX_DB_USER|g" \
          -e "s|__DEX_DB_PASSWORD__|$$DEX_DB_PASSWORD|g" \
          -e "s|__GITEA_OAUTH2_CLIENT_ID__|$$GITEA_OAUTH2_CLIENT_ID|g" \
          -e "s|__GITEA_OAUTH2_CLIENT_SECRET__|$$GITEA_OAUTH2_CLIENT_SECRET|g" \
          -e "s|__GITEA_HOST__|$$GITEA_HOST|g" \
          /etc/dex/dex.yml > /tmp/dex.yml &&
        exec dex serve /tmp/dex.yml
    ports:
      - "${DEX_HTTP_PORT:-5556}:5556"
    environment:
      - DEX_ISSUER_HOST=${DEX_ISSUER_HOST:-localhost}
      - DEX_DB_NAME=${DEX_DB_NAME:-dex}
      - DEX_DB_USER=${DEX_DB_USER:-dex}
      - DEX_DB_PASSWORD=${DEX_DB_PASSWORD:-dex}
      - GITEA_HOST=${GITEA_HOST:-localhost}
      - GITEA_OAUTH2_CLIENT_ID=${GITEA_OAUTH2_CLIENT_ID:-gitea}
      - GITEA_OAUTH2_CLIENT_SECRET=${GITEA_OAUTH2_CLIENT_SECRET:-gitea-dex-secret}
    volumes:
      - ./dex.yml:/etc/dex/dex.yml:ro
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:5558/healthz"]
      interval: 5s
      timeout: 5s
      retries: 5

  db:
    image: postgres:${POSTGRES_VERSION:-17-alpine}
    environment:
      - POSTGRES_USER=${GITEA_DB_USER:-gitea}
      - POSTGRES_PASSWORD=${GITEA_DB_PASSWORD:-gitea}
      - POSTGRES_DB=${GITEA_DB_NAME:-gitea}
      - DEX_DB_NAME=${DEX_DB_NAME:-dex}
      - DEX_DB_USER=${DEX_DB_USER:-dex}
      - DEX_DB_PASSWORD=${DEX_DB_PASSWORD:-dex}
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./init-db.sh:/docker-entrypoint-initdb.d/init-db.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${GITEA_DB_USER:-gitea}"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  gitea_data:
  db_data:
```

すべての設定値は `${VAR:-default}` パターンで環境変数から上書き可能です。

---

# dex.yml

```yaml
issuer: http://__DEX_ISSUER_HOST__:5556/dex

storage:
  type: postgres
  config:
    host: db
    port: 5432
    database: __DEX_DB_NAME__
    user: __DEX_DB_USER__
    password: __DEX_DB_PASSWORD__
    ssl:
      mode: disable

web:
  http: 0.0.0.0:5556

telemetry:
  http: 0.0.0.0:5558

oauth2:
  skipApprovalScreen: true

staticClients:
  - id: __GITEA_OAUTH2_CLIENT_ID__
    redirectURIs:
      - "http://__GITEA_HOST__:3000/user/oauth2/dex/callback"
    name: "Gitea"
    secret: __GITEA_OAUTH2_CLIENT_SECRET__

enablePasswordDB: true

staticPasswords:
  - email: "admin@example.com"
    hash: "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W"
    username: "admin"
    userID: "08a8684b-db88-4b73-90a9-3cd1661f5466"
```

- **staticClients**: Giteaを OAuth2 クライアントとして登録。`redirectURIs` は Gitea の認証コールバックURL
- **staticPasswords**: テスト用ユーザー `admin@example.com`（パスワード: `password`）。本番では削除して外部コネクタに置き換えてください
- **oauth2.skipApprovalScreen**: 同一組織内利用を想定し、承認画面をスキップ

---

# デプロイ手順

## 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/gitea
```

## 2. サーバー作成

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
```

## 3. アプリ初期化

```bash
conoha app init myserver --app-name gitea
```

## 4. 環境変数の設定

```bash
conoha app env set myserver --app-name gitea \
  GITEA_DB_PASSWORD=your_gitea_db_password \
  DEX_DB_PASSWORD=your_dex_db_password \
  GITEA_OAUTH2_CLIENT_SECRET=your_oauth2_secret \
  DEX_ISSUER_HOST=your-server-ip \
  GITEA_HOST=your-server-ip
```

## 5. デプロイ

```bash
conoha app deploy myserver --app-name gitea
```

実際のデプロイ出力:

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Container gitea-db-1 Created
 Container gitea-db-1 Started
 Container gitea-db-1 Healthy
 Container gitea-dex-1 Created
 Container gitea-dex-1 Started
 Container gitea-dex-1 Healthy
 Container gitea-gitea-1 Created
 Container gitea-gitea-1 Started
Deploy complete.
```

---

# 動作確認

## コンテナの状態

```bash
conoha app status myserver --app-name gitea
```

```
NAME            IMAGE                STATUS                    PORTS
gitea-db-1      postgres:17-alpine   Up 23 seconds (healthy)   5432/tcp
gitea-dex-1     dexidp/dex:v2.45.1   Up 17 seconds (healthy)   0.0.0.0:5556->5556/tcp
gitea-gitea-1   gitea/gitea:latest   Up 11 seconds             0.0.0.0:3000->3000/tcp, 0.0.0.0:2222->22/tcp
```

3つのコンテナがすべて正常に起動しています。

## Dex OIDC Discovery

```bash
curl -s http://<サーバーIP>:5556/dex/.well-known/openid-configuration | jq .issuer
```

```
"http://<サーバーIP>:5556/dex"
```

issuer が正しくサーバーIPに展開されていればOKです。

## Gitea Web UI

ブラウザで `http://<サーバーIP>:3000` にアクセスすると初期セットアップ画面が表示されます。管理者アカウントを作成してください。

## OIDC認証プロバイダーの登録

Gitea管理画面からDexをOIDCプロバイダーとして登録します:

1. **サイト管理** → **認証ソース** → **認証ソースを追加**
2. 以下を入力:

| 項目 | 値 |
|------|-----|
| 認証タイプ | OAuth2 |
| 認証名 | `dex` |
| OAuth2 プロバイダー | OpenID Connect |
| クライアント ID | `gitea` |
| クライアントシークレット | `gitea-dex-secret`（または設定した値） |
| OpenID Connect 自動検出 URL | `http://dex:5556/dex/.well-known/openid-configuration` |

3. **認証ソースを追加** をクリック

ログイン画面に「Dex でサインイン」ボタンが表示され、テスト用ユーザー（`admin@example.com` / `password`）でログインできます。

---

# つまずきポイントまとめ

| 問題 | 原因 | 解決策 |
|------|------|--------|
| Dex の issuer が `$DEX_ISSUER_HOST` のまま | Dex は設定ファイルの環境変数を自動展開しない | `sed` による entrypoint テンプレート置換 |
| Dex が DB 接続に失敗 | `dex` データベースが存在しない | `init-db.sh` で初期化時に作成 |
| Gitea のポートバインドに失敗 | 他アプリが同じポートを使用中 | `docker ps` で確認し競合コンテナを停止 |
| `init-db.sh` が実行されない | PostgreSQL データボリュームが既に存在 | `docker volume rm` でボリューム削除後に再デプロイ |

---

# なぜ Gitea + Dex なのか

**Giteaを使う理由:**
- 軽量で開発サーバーにも気軽にインストールできる
- ビジュアルなリポジトリUIが開発のモチベーションになる
- 公式CLI [tea](https://gitea.com/gitea/tea) でターミナルから操作可能、加えてREST APIも完備しておりAIエージェント経由でも管理できる
- [act_runner](https://gitea.com/gitea/act_runner) によるGitea Actions（GitHub Actions互換）でCI/CDもセルフホスト可能
- クラウド上のリソース管理なので、ローカル環境をリセットしても影響なし

**Dexを使う理由:**
- 超軽量なOIDCプロバイダー（会員登録フォームすら不要）
- LDAP、GitHub、Google等の外部IdPへの認証中継に特化
- PostgreSQLをGiteaと共有できるのでリソース効率が良い

---

# カスタマイズのヒント

- **本番運用**: `GITEA_DB_PASSWORD`、`DEX_DB_PASSWORD`、`GITEA_OAUTH2_CLIENT_SECRET` は必ず変更
- **外部IdP連携**: `dex.yml` に `connectors` セクションを追加してLDAP/GitHub/Google等と接続可能
- **ローカル登録無効化**: `GITEA_DISABLE_REGISTRATION=true` + `GITEA_ALLOW_ONLY_EXTERNAL=true` でOIDCのみに制限
- **HTTPS対応**: nginx リバースプロキシを前段に追加
- **CI/CD**: [act_runner](https://gitea.com/gitea/act_runner) を追加してGitea Actions（GitHub Actions互換ワークフロー）を実行可能
- **CLI操作**: [tea](https://gitea.com/gitea/tea) をインストールすれば `tea issues create`、`tea pr list` 等でターミナルから操作可能

---

# まとめ

Gitea + Dex（OIDC認証）+ PostgreSQL の構成を、以下の **3コマンド** でConoHa VPSにデプロイできました。

```bash
conoha app init myserver --app-name gitea
conoha app env set myserver --app-name gitea DEX_ISSUER_HOST=<IP> GITEA_HOST=<IP> ...
conoha app deploy myserver --app-name gitea
```

| URL | 用途 |
|-----|------|
| `http://<IP>:3000` | Gitea Web UI |
| `http://<IP>:5556/dex` | Dex OIDC Provider |
| `ssh://git@<IP>:2222` | Git SSH |

サンプルコード: https://github.com/crowdy/conoha-cli-app-samples/tree/main/gitea

conoha-cli: https://github.com/crowdy/conoha-cli

他にも30種類以上のサンプルが揃っていますので、ぜひ試してみてください。


