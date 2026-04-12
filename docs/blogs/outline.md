---
title: conoha-cliでOutline（セルフホストWiki）をConoHa VPSにワンコマンドデプロイ
tags: Docker Conoha outline wiki conoha-cli
author: crowdy
slide: false
---
## はじめに

チームのナレッジベースとして [Notion](https://www.notion.com/) を使っているチームは多いと思いますが、データを自社管理したい、APIで自由に拡張したいというニーズもあるのではないでしょうか。

この記事では、Notionライクなセルフホスト型Wiki **[Outline](https://www.getoutline.com/)** を、ConoHa VPS3上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。

Outlineは「SSOが必須でログインできない」というセルフホスト特有のハードルがありますが、軽量OIDCプロバイダー **Dex** を同梱することで、外部サービスなしで即座にログインできる構成にしました。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## Outlineとは

[Outline](https://www.getoutline.com/) は、オープンソースのチーム向けWiki・ナレッジベースです。

| 特徴 | 説明 |
|------|------|
| **リアルタイム共同編集** | 複数人が同時にドキュメントを編集可能 |
| **Markdownエディタ** | `/` コマンドによるスラッシュメニュー、ドラッグ&ドロップ |
| **REST API** | ドキュメントの作成・検索・更新をAPI経由で自動化可能 |
| **全文検索** | 高速な日本語対応の全文検索 |
| **権限管理** | コレクション単位での閲覧・編集権限 |

以前 [Etherpad](https://etherpad.org/) を使っていたことがありますが、OutlineはUIが格段に洗練されており、Notionを日常的に使っているユーザーでも違和感なく移行できるレベルです。

特にAPIが充実しているため、AIにドキュメントを自動生成させたり、外部ツールと連携してナレッジを自動蓄積するといった使い方も可能です。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

### 主な機能

- **サーバー管理**: VPSの作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリをVPSにデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認
- **環境変数管理**: `app env set` でセキュアに環境変数を注入

`app deploy` コマンドは内部でDockerとDocker Composeを自動セットアップし、ディレクトリをgit push形式でVPSへ転送してコンテナを起動します。SSHキーさえ設定すれば、コマンド1本でデプロイが完了します。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Outline** v0.82 | Wiki / ナレッジベース |
| **PostgreSQL** 16 | データベース |
| **Redis** 7 | キャッシュ・リアルタイム同期 |
| **Dex** v2.39 | OIDC プロバイダー（SSO 認証） |

### アーキテクチャ

```
ブラウザ → Outline (:3000)
              ├── PostgreSQL (:5432)
              ├── Redis (:6379)
              └── Dex (:5556) ← ログイン時のOIDC認証
```

---

## ハマりポイント: OutlineはSSOが必須

Outlineをセルフホストする際の最大のハードルは **ログインにSSOが必須** という点です。

初回デプロイ後にブラウザでアクセスすると、画面にはログインボタンが一切表示されません。JavaScriptコンソールには以下のエラーが出るだけです。

```
Failed to load resource: the server responded with a status of 401 (Unauthorized)
Uncaught (in promise) AuthorizationError
```

Outlineはメール/パスワードによるローカル認証をサポートしておらず、Slack、Google、Azure AD、OIDCなどの外部SSOプロバイダーの設定が必須です。

---

## 解決策: Dexを同梱してOIDC認証を自己完結させる

外部サービスに依存せずに動かすため、軽量OIDCプロバイダー [Dex](https://dexidp.io/) をcompose構成に組み込みました。Dexに静的ユーザーを定義することで、外部サービスの設定なしで即座にログインできます。

### dex-config.yml

```yaml
issuer: http://YOUR_SERVER_IP:5556/dex

storage:
  type: sqlite3
  config:
    file: /var/dex/dex.db

web:
  http: 0.0.0.0:5556

oauth2:
  skipApprovalScreen: true

staticClients:
  - id: outline
    redirectURIs:
      - http://YOUR_SERVER_IP:3000/auth/oidc.callback
    name: Outline
    secret: outline-dex-secret

enablePasswordDB: true

staticPasswords:
  - email: admin@example.com
    hash: "$2a$10$2b2cU8CPhOTaGrs1HRQuAueS7JTT5ZHsHSzYiFPm1leZck7Mc8T4W"
    username: admin
    userID: "08a8684b-db88-4b73-90a9-3cd1661f5466"
```

`YOUR_SERVER_IP` はデプロイ前に `sed` で実際のIPに置換します。静的パスワードのハッシュは `password` に対応するbcryptハッシュです。

---

## もう一つのハマりポイント: PostgreSQL SSL接続エラー

Outline v0.82はデフォルトでPostgreSQLへのSSL接続を試みます。Docker Compose内のPostgreSQLはSSLを有効にしていないため、以下のエラーでOutlineが起動に失敗します。

```json
{
  "error": "The server does not support SSL connections",
  "message": "Set the `PGSSLMODE` environment variable to `disable`..."
}
```

`PGSSLMODE=disable` を環境変数に追加することで解決しました。

---

## ファイル構成

```
outline/
├── compose.yml
├── dex-config.yml
└── README.md
```

### compose.yml

```yaml
services:
  outline:
    image: outlinewiki/outline:0.82.0
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://outline:${DB_PASSWORD:-outline}@db:5432/outline
      - REDIS_URL=redis://redis:6379
      - SECRET_KEY=${SECRET_KEY:-please-change-me-use-openssl-rand-hex-32}
      - UTILS_SECRET=${UTILS_SECRET:-please-change-me-use-openssl-rand-hex-32}
      - URL=${URL:-http://localhost:3000}
      - FILE_STORAGE=local
      - FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data
      - PGSSLMODE=${PGSSLMODE:-disable}
      - FORCE_HTTPS=false
      - OIDC_CLIENT_ID=outline
      - OIDC_CLIENT_SECRET=outline-dex-secret
      - OIDC_AUTH_URI=${OIDC_AUTH_URI:-http://localhost:5556/dex/auth}
      - OIDC_TOKEN_URI=http://dex:5556/dex/token
      - OIDC_USERINFO_URI=http://dex:5556/dex/userinfo
      - OIDC_DISPLAY_NAME=Dex Login
    volumes:
      - outline_data:/var/lib/outline/data
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
      dex:
        condition: service_started
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=outline
      - POSTGRES_PASSWORD=${DB_PASSWORD:-outline}
      - POSTGRES_DB=outline
    volumes:
      - outline_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U outline"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - outline_redis:/data

  dex:
    image: dexidp/dex:v2.39.1
    ports:
      - "5556:5556"
    volumes:
      - ./dex-config.yml:/etc/dex/config.docker.yaml
      - dex_data:/var/dex
    command: ["dex", "serve", "/etc/dex/config.docker.yaml"]

volumes:
  outline_data:
  outline_db:
  outline_redis:
  dex_data:
```

OIDC関連の環境変数がポイントです。`OIDC_AUTH_URI`はブラウザからアクセスするため外部IPを使い、`OIDC_TOKEN_URI`と`OIDC_USERINFO_URI`はOutlineコンテナからDexコンテナへの内部通信のためDockerのサービス名 `dex` を使っています。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/outline
```

### 2. アプリ初期化

```bash
conoha app init myserver --app-name outline
```

```
Initializing app "outline" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/outline.git/
==> Installing post-receive hook...
==> Done!

App "outline" initialized on vm-18268c66-ae (133.88.116.147).
```

### 3. Dex設定のIP置換

```bash
sed -i 's/YOUR_SERVER_IP/133.88.116.147/g' dex-config.yml
```

### 4. 環境変数の設定

```bash
conoha app env set myserver --app-name outline \
  SECRET_KEY=$(openssl rand -hex 32) \
  UTILS_SECRET=$(openssl rand -hex 32) \
  DB_PASSWORD=your-secure-password \
  URL=http://133.88.116.147:3000 \
  OIDC_AUTH_URI=http://133.88.116.147:5556/dex/auth
```

```
Set DB_PASSWORD
Set SECRET_KEY
Set URL
Set UTILS_SECRET
Set OIDC_AUTH_URI
```

### 5. デプロイ

```bash
conoha app deploy myserver --app-name outline
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image outlinewiki/outline:0.82.0 Pulling
 Image postgres:16-alpine Pulling
 Image redis:7-alpine Pulling
 Image dexidp/dex:v2.39.1 Pulling
 ...
 Container outline-redis-1 Started
 Container outline-db-1 Started
 Container outline-db-1 Healthy
 Container outline-dex-1 Started
 Container outline-outline-1 Started
NAME                IMAGE                        STATUS                    PORTS
outline-db-1        postgres:16-alpine           Up 6 seconds (healthy)    5432/tcp
outline-dex-1       dexidp/dex:v2.39.1           Up 1 second               0.0.0.0:5556->5556/tcp
outline-outline-1   outlinewiki/outline:0.82.0   Up Less than a second     0.0.0.0:3000->3000/tcp
outline-redis-1     redis:7-alpine               Up 6 seconds              6379/tcp
Deploy complete.
```

4つのコンテナがすべて起動しました。

---

## 動作確認

### ログ確認

```bash
conoha app logs myserver --app-name outline
```

```
outline-1  | {"label":"lifecycle","level":"info","message":"Starting web service"}
outline-1  | {"label":"lifecycle","level":"info","message":"Listening on http://localhost:3000"}
```

### ブラウザでアクセス

`http://<サーバーIP>:3000` にアクセスすると、「Dex Login」ボタンが表示されます。

クリックするとDexのログイン画面に遷移します。

- **Email**: `admin@example.com`
- **Password**: `password`

ログイン後、チーム名を入力するとOutlineのダッシュボードが表示されます。

---

## 使ってみた感想

以前 Etherpad を使っていたことがありますが、Outlineは比較にならないほど洗練されています。

- **エディタの完成度**: Notionライクなスラッシュコマンド(`/`)、ドラッグ&ドロップでのブロック移動、Markdownのリアルタイムレンダリング。普段Notionを使っているユーザーでも違和感なく使えるレベルです
- **リアルタイム共同編集**: 複数人が同時に同じドキュメントを編集でき、カーソル位置もリアルタイムで表示されます。チームでのドキュメント作成がスムーズです
- **充実したAPI**: `POST /api/documents.create` でドキュメントを作成、`POST /api/documents.search` で全文検索が可能。AIにドキュメントを自動生成させたり、CIパイプラインからリリースノートを自動投稿するといった活用が考えられます

Notionからの移行先として十分な選択肢になると感じました。

---

## カスタマイズのヒント

### Dexユーザーの追加

`dex-config.yml` の `staticPasswords` にエントリを追加します。パスワードハッシュは以下で生成できます。

```bash
htpasswd -bnBC 10 "" 'your-password' | tr -d ':'
```

### 外部IdPとの連携

Dexは静的ユーザーだけでなく、LDAP、GitHub、Googleなどの外部IdPとの連携も可能です。本番環境では `dex-config.yml` の `connectors` セクションで外部IdPを設定することを推奨します。

### 本番環境での注意点

- `SECRET_KEY`、`UTILS_SECRET`、`DB_PASSWORD` は必ずランダム値に変更
- HTTPS化する場合はリバースプロキシ（nginx等）を前段に配置し、`FORCE_HTTPS=true` に変更
- Dexを使わずSlack / Google / Azure ADのOIDCを直接設定することも可能

---

## つまずきポイントまとめ

| 問題 | 原因 | 解決策 |
|------|------|--------|
| ログインボタンが表示されない | SSO未設定 | Dex（OIDCプロバイダー）を同梱 |
| PostgreSQL SSL接続エラー | Outline v0.82がデフォルトでSSLを要求 | `PGSSLMODE=disable` を設定 |

---

## まとめ

conoha-cliの `app init` → `app env set` → `app deploy` の3コマンドで、Outline + PostgreSQL + Redis + DexのWikiスタックをConoHa VPS3上に構築できました。

| アクセス先 | URL |
|---|---|
| Outline Web UI | `http://<IP>:3000` |
| Dex OIDC | `http://<IP>:5556` |

サンプルのソースコードは以下で公開しています。

https://github.com/crowdy/conoha-cli-app-samples/tree/main/outline

他にもWordPress、Strapi、Quickwit + OpenTelemetry、Gitea、Ollamaなど20種類以上のサンプルが揃っていますので、ぜひ試してみてください。

