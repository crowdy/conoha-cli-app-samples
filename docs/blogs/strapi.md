---
title: conoha-cliでStrapi（ヘッドレスCMS）をConoHa VPSにワンコマンドデプロイ
tags: Docker Conoha strapi conoha-cli HeadlessCMS
author: crowdy
slide: false
---
## はじめに

ヘッドレスCMS [Strapi](https://strapi.io/) を ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。

Strapiはv4以降、公式Dockerイメージを提供していません。そのため「Dockerで簡単に動かしたい」と思っても、Dockerfileを自分で書く必要があります。この記事では、ビルド時に遭遇する対話プロンプト問題の回避方法も含めて、実際のデプロイ手順を解説します。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

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

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み（`conoha keypair create` で作成可能）

---

## ファイル構成

```
strapi-postgresql/
├── compose.yml
├── Dockerfile
├── .dockerignore
└── README.md
```

---

## ハマりポイント: Strapiには公式Dockerイメージがない

最初は `strapi/strapi:5-alpine` を使おうとしましたが、このイメージは存在しません。

```
Error response from daemon: failed to resolve reference
"docker.io/strapi/strapi:5-alpine": not found
```

次に `elestio/strapi:v4.25` を試しましたが、こちらもタグが存在しません。`elestio/strapi` には `:latest` しかありませんでした。

```
Error response from daemon: failed to resolve reference
"docker.io/elestio/strapi:v4.25": not found
```

**結論**: Strapiをバージョン固定してDockerで動かすには、Dockerfileビルドが必須です。

---

## さらにハマる: create-strapi-appの対話プロンプト

`node:20-alpine` ベースでDockerfileを書き、`npx create-strapi-app` でプロジェクトを生成するアプローチにしました。しかし、Strapi v4.25.9でも **Strapi Cloudへのログインプロンプト** が表示され、非対話環境（Dockerビルド）では応答できずビルドが失敗します。

```
? Please log in or sign up. (Use arrow keys)
❯ Login/Sign up
  Skip
npm error command failed
npm error signal SIGINT
```

これは `echo "n"` をパイプで渡すことで回避しました。

---

## 最終的なDockerfile

```dockerfile
FROM node:20-alpine

RUN apk add --no-cache build-base python3

WORKDIR /app

# Create Strapi project non-interactively (pipe yes to skip cloud login prompt)
ENV STRAPI_DISABLE_REMOTE_DATA_TRANSFER=true
RUN echo "n" | npx --yes create-strapi-app@4.25.9 . \
  --no-run \
  --dbclient postgres \
  --dbhost db \
  --dbport 5432 \
  --dbname strapi \
  --dbusername strapi \
  --dbpassword strapi \
  --dbssl false \
  || true

# Verify package.json exists (project was created)
RUN test -f /app/package.json

# Install pg driver
RUN npm install pg

EXPOSE 1337
CMD ["npm", "run", "develop"]
```

ポイント:

- `echo "n" |` でCloud Loginプロンプトをスキップ
- `|| true` でプロンプト関連のexit code 1を無視
- `test -f /app/package.json` でプロジェクト生成を検証（失敗していたらここでビルドが止まる）
- `npm install pg` でPostgreSQLドライバを追加

---

## compose.yml

```yaml
services:
  strapi:
    build: .
    ports:
      - "1337:1337"
    environment:
      - DATABASE_CLIENT=postgres
      - DATABASE_HOST=db
      - DATABASE_PORT=5432
      - DATABASE_NAME=strapi
      - DATABASE_USERNAME=strapi
      - DATABASE_PASSWORD=${DB_PASSWORD:-strapi}
      - APP_KEYS=${APP_KEYS:-key1,key2,key3,key4}
      - API_TOKEN_SALT=${API_TOKEN_SALT:-change-me}
      - ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET:-change-me}
      - TRANSFER_TOKEN_SALT=${TRANSFER_TOKEN_SALT:-change-me}
      - JWT_SECRET=${JWT_SECRET:-change-me}
    volumes:
      - strapi_uploads:/opt/app/public/uploads
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=strapi
      - POSTGRES_PASSWORD=${DB_PASSWORD:-strapi}
      - POSTGRES_DB=strapi
    volumes:
      - strapi_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U strapi"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  strapi_uploads:
  strapi_db:
```

環境変数は `${VAR:-default}` パターンで、`conoha app env set` での上書きに対応しています。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/strapi-postgresql
```

### 2. アプリ初期化

```bash
conoha app init myserver --app-name strapi-postgresql
```

```
Initializing app "strapi-postgresql" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/strapi-postgresql.git/
==> Installing post-receive hook...
==> Done!

App "strapi-postgresql" initialized on vm-18268c66-ae (133.88.116.147).
```

### 3. 環境変数の設定

```bash
conoha app env set myserver --app-name strapi-postgresql \
  DB_PASSWORD=your-secure-password \
  APP_KEYS=key1,key2,key3,key4 \
  API_TOKEN_SALT=$(openssl rand -base64 16) \
  ADMIN_JWT_SECRET=$(openssl rand -base64 16) \
  JWT_SECRET=$(openssl rand -base64 16)
```

```
Set ADMIN_JWT_SECRET
Set API_TOKEN_SALT
Set APP_KEYS
Set DB_PASSWORD
Set JWT_SECRET
```

### 4. デプロイ

```bash
conoha app deploy myserver --app-name strapi-postgresql
```

初回はDockerイメージのビルドが走るため約3〜4分かかります。

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image postgres:16-alpine Pulling
 ...
 Image postgres:16-alpine Pulled
 Image strapi-postgresql-strapi Building
#1 [internal] load local bake definitions
...
#8 [4/5] RUN echo "n" | npx --yes create-strapi-app@4.25.9 . ...
#8 55.99
#8 55.99  Strapi   v5.41.1 🚀 Let's create your new project
#8 55.99
...
#11 exporting to image
#11 naming to docker.io/library/strapi-postgresql-strapi:latest done
#11 DONE 217.0s
...
 Container strapi-postgresql-db-1 Started
 Container strapi-postgresql-db-1 Waiting
 Container strapi-postgresql-db-1 Healthy
 Container strapi-postgresql-strapi-1 Started
NAME                         IMAGE                      STATUS
strapi-postgresql-db-1       postgres:16-alpine         Up 6 seconds (healthy)
strapi-postgresql-strapi-1   strapi-postgresql-strapi   Up Less than a second
Deploy complete.
```

healthcheckにより、PostgreSQLがReadyになってからStrapiが起動する順序制御が行われています。

---

## 動作確認

### コンテナ状態

```bash
conoha app status myserver --app-name strapi-postgresql
```

```
NAME                         IMAGE                      STATUS
strapi-postgresql-db-1       postgres:16-alpine         Up 13 seconds (healthy)
strapi-postgresql-strapi-1   strapi-postgresql-strapi   Up Less than a second
```

### ログ確認

```bash
conoha app logs myserver --app-name strapi-postgresql --service strapi
```

```
strapi-1  | ┌────────────────────┬──────────────────────────────────────────────────┐
strapi-1  | │ Time               │ Mon Apr 06 2026 09:13:16 GMT+0000                │
strapi-1  | │ Launched in        │ 4382 ms                                          │
strapi-1  | │ Environment        │ development                                      │
strapi-1  | │ Process PID        │ 42                                               │
strapi-1  | │ Version            │ 4.25.9 (node v20.20.2)                           │
strapi-1  | │ Edition            │ Community                                        │
strapi-1  | │ Database           │ postgres                                         │
strapi-1  | └────────────────────┴──────────────────────────────────────────────────┘
strapi-1  |
strapi-1  |  Actions available
strapi-1  |
strapi-1  | One more thing...
strapi-1  | Create your first administrator 💻 by going to the administration panel at:
strapi-1  |
strapi-1  | ┌─────────────────────────────┐
strapi-1  | │ http://localhost:1337/admin │
strapi-1  | └─────────────────────────────┘
```

### 管理画面へアクセス

ブラウザで `http://<サーバーIP>:1337/admin` にアクセスすると、初期管理者アカウントの作成画面が表示されます。

アカウント作成後、Content-Type BuilderでAPIスキーマを定義し、`http://<サーバーIP>:1337/api/<content-type>` でREST APIが即座に利用可能になります。

---

## つまずきポイントまとめ

| 問題 | 原因 | 解決策 |
|------|------|--------|
| `strapi/strapi:5-alpine` が見つからない | Strapi v4以降は公式Dockerイメージ未提供 | Dockerfileビルドに変更 |
| `elestio/strapi:v4.25` が見つからない | `:latest` タグのみ存在 | 同上 |
| ビルド中にプロンプトで停止 | Strapi Cloud Loginの対話プロンプト | `echo "n" \|` でスキップ |
| `config/database.js` が作成できない | `--quickstart` ではディレクトリ構造が不完全 | `--dbclient postgres` で直接指定 |

---

## まとめ

Strapiは優れたヘッドレスCMSですが、Docker環境での導入にはいくつかのハマりポイントがあります。この記事で紹介したDockerfileを使えば、`conoha app deploy` ワンコマンドでConoHa VPS上にStrapiを展開できます。

サンプルコードはすべて以下のリポジトリで公開しています。

- サンプル: [crowdy/conoha-cli-app-samples/strapi-postgresql](https://github.com/crowdy/conoha-cli-app-samples/tree/main/strapi-postgresql)
- CLI: [crowdy/conoha-cli](https://github.com/crowdy/conoha-cli)

