---
title: conoha-cliでSupabaseセルフホストをConoHa VPSにワンコマンドデプロイ
tags: Supabase Docker Conoha PostgreSQL BaaS
author: crowdy
slide: false
---
## はじめに

Firebase の代替として注目されている **Supabase** を、自前のサーバーで動かしたいと思ったことはありませんか？

Supabaseはオープンソースで、セルフホストが可能です。しかし公式の `docker-compose.yml` は20以上のサービスを含む大規模な構成で、初めて触る人にとっては敷居が高いのが実情です。

この記事では、Supabaseの主要コンポーネントに絞ったミニマル構成を ConoHa VPS3 上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。デプロイ中にハマったPostgreSQLの認証問題とその解決策も共有します。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## Supabaseとは

[Supabase](https://supabase.com/) は「Firebase Alternative」を標榜するオープンソースのBaaS（Backend as a Service）プラットフォームです。PostgreSQLをコアに据え、認証・REST API・リアルタイム通知・ストレージといったバックエンド機能をすぐに使える形で提供します。

Supabase Cloudを使えばインフラ管理なしで始められますが、データの完全な管理権限が必要な場合や、特定のネットワーク要件がある場合は、セルフホストが選択肢になります。

---

## 使用するコンポーネント

今回デプロイするミニマル構成は6つのサービスで構成されています。

| コンポーネント | イメージ | 役割 |
|---|---|---|
| **Studio** | `supabase/studio:latest` | Supabaseの管理UI。テーブルの作成・編集、SQLエディタ、認証ユーザー管理などをブラウザから操作できる |
| **Kong** | `kong:3.9` | APIゲートウェイ。外部からのリクエストを各内部サービスにルーティングし、APIキー認証やCORSを処理する |
| **GoTrue (Auth)** | `supabase/gotrue:v2.170.0` | 認証サービス。メール/パスワード認証、OAuth、JWTトークン発行を担当する |
| **PostgREST** | `postgrest/postgrest:v12.2.12` | PostgreSQLのテーブルをそのままREST APIとして公開する。テーブルを作成するだけでCRUD APIが自動生成される |
| **Postgres Meta** | `supabase/postgres-meta:v0.88.2` | PostgreSQLのメタデータAPI。Studioがテーブル定義やカラム情報を取得するために使用する |
| **PostgreSQL** | `supabase/postgres:15.8.1.060` | データベース本体。Supabase専用の拡張とロール設定が含まれたカスタムイメージ |

### アーキテクチャ

```
ブラウザ (Studio)
  ↓ :3000
Studio → Postgres Meta (:8080) → PostgreSQL (:5432)
  ↓
Kong (API Gateway :8000)
  ├── /auth/v1/  → GoTrue (:9999)
  ├── /rest/v1/  → PostgREST (:3000)
  └── /pg/       → Postgres Meta (:8080)
```

外部からのAPIリクエストはすべてKong経由でルーティングされます。Kongは `apikey` ヘッダーでJWTを検証し、`anon` と `service_role` の2つの権限レベルでアクセスを制御します。

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
supabase-selfhost/
├── compose.yml
├── kong.yml
├── init/
│   └── set-role-passwords.sh
└── README.md
```

---

## ハマりポイント: PostgreSQLロールのパスワード未設定問題

### 症状

デプロイ後、GoTrue（Auth）とPostgRESTが起動と停止を繰り返す。

```
auth-1  | {"level":"fatal","msg":"failed to connect to `host=db user=supabase_auth_admin`:
  failed SASL auth (FATAL: password authentication failed for user \"supabase_auth_admin\")"}
```

### 原因

`supabase/postgres:15.8.1.060` イメージは初期化時に `supabase_auth_admin`、`authenticator` などの内部ロールを作成しますが、**パスワードを設定しません**。一方、Supabase専用の `pg_hba.conf` はDockerネットワーク（`172.16.0.0/12`）からの接続に `scram-sha-256` 認証を要求します。

```
# Supabase pg_hba.conf（抜粋）
local all  supabase_admin     scram-sha-256
host  all  all  172.16.0.0/12  scram-sha-256
```

つまり、パスワードなしのロールがパスワード認証を要求される、という矛盾が発生していました。

### 解決策

Docker Entrypointの初期化スクリプト（`/docker-entrypoint-initdb.d/`）で、ロールにパスワードを設定するシェルスクリプトを追加しました。

```bash
#!/bin/bash
set -e

# supabase_admin はスーパーユーザーだが、ローカルソケット接続でも
# scram-sha-256 が要求されるため、PGPASSWORD を明示的に設定する
export PGPASSWORD="${POSTGRES_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username supabase_admin --dbname "${POSTGRES_DB:-postgres}" <<-EOSQL
    ALTER ROLE supabase_auth_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
    ALTER ROLE authenticator WITH PASSWORD '${POSTGRES_PASSWORD}';
    ALTER ROLE supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
EOSQL
```

ファイル名を `zzz-set-role-passwords.sh` として、Supabase自身のマイグレーションスクリプト（`migrate.sh`）よりも後に実行されるようにしています。

---

## compose.yml

```yaml
services:
  studio:
    image: supabase/studio:latest
    ports:
      - "3000:3000"
    environment:
      - STUDIO_PG_META_URL=http://meta:8080
      - SUPABASE_URL=http://kong:8000
      - SUPABASE_ANON_KEY=${ANON_KEY:-eyJhbGci...}
      - SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY:-eyJhbGci...}
    depends_on:
      - meta
    restart: unless-stopped

  kong:
    image: kong:3.9
    ports:
      - "8000:8000"
    environment:
      - KONG_DATABASE=off
      - KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml
      - KONG_DNS_ORDER=LAST,A,CNAME
      - KONG_PLUGINS=request-transformer,cors,key-auth,acl,basic-auth
    volumes:
      - ./kong.yml:/home/kong/kong.yml:ro
    restart: unless-stopped

  auth:
    image: supabase/gotrue:v2.170.0
    environment:
      - GOTRUE_API_HOST=0.0.0.0
      - GOTRUE_API_PORT=9999
      - API_EXTERNAL_URL=${API_EXTERNAL_URL:-http://localhost:8000}
      - GOTRUE_DB_DRIVER=postgres
      - GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${POSTGRES_PASSWORD:-postgres}@db:5432/postgres
      - GOTRUE_SITE_URL=${SITE_URL:-http://localhost:3000}
      - GOTRUE_JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters}
      - GOTRUE_JWT_EXP=3600
      - GOTRUE_DISABLE_SIGNUP=false
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  rest:
    image: postgrest/postgrest:v12.2.12
    environment:
      - PGRST_DB_URI=postgres://authenticator:${POSTGRES_PASSWORD:-postgres}@db:5432/postgres
      - PGRST_DB_SCHEMAS=public,storage,graphql_public
      - PGRST_DB_ANON_ROLE=anon
      - PGRST_JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  meta:
    image: supabase/postgres-meta:v0.88.2
    environment:
      - PG_META_PORT=8080
      - PG_META_DB_HOST=db
      - PG_META_DB_PORT=5432
      - PG_META_DB_NAME=postgres
      - PG_META_DB_USER=supabase_admin
      - PG_META_DB_PASSWORD=${POSTGRES_PASSWORD:-postgres}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: supabase/postgres:15.8.1.060
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
      - JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters}
    volumes:
      - supabase_db:/var/lib/postgresql/data
      - ./init/set-role-passwords.sh:/docker-entrypoint-initdb.d/zzz-set-role-passwords.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U supabase_admin"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  supabase_db:
```

`db` サービスの `healthcheck` により、PostgreSQLがReadyになってから依存サービスが起動する順序制御を行っています。PostgreSQLのポート `5432` は `127.0.0.1` にバインドしており、コンテナ外部からの直接アクセスを防いでいます。

---

## kong.yml（APIゲートウェイ設定）

```yaml
_format_version: "2.1"

services:
  - name: auth-v1
    url: http://auth:9999/
    routes:
      - name: auth-v1-route
        strip_path: true
        paths:
          - /auth/v1/
    plugins:
      - name: cors

  - name: rest-v1
    url: http://rest:3000/
    routes:
      - name: rest-v1-route
        strip_path: true
        paths:
          - /rest/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
          key_names:
            - apikey

consumers:
  - username: anon
    keyauth_credentials:
      - key: <anon-key>
  - username: service_role
    keyauth_credentials:
      - key: <service-role-key>
```

Kongはデータベースレスモード（`KONG_DATABASE=off`）で動作し、宣言的設定ファイルでルーティングを定義します。REST APIへのアクセスには `apikey` ヘッダーによるキー認証が必要で、`anon` と `service_role` の2つの権限レベルが設定されています。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/supabase-selfhost
```

### 2. アプリ初期化

```bash
conoha app init myserver --app-name supabase-selfhost
```

```
Initializing app "supabase-selfhost" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/supabase-selfhost.git/
==> Installing post-receive hook...
==> Done!

App "supabase-selfhost" initialized on vm-18268c66-ae (133.88.116.147).
```

### 3. 環境変数の設定

```bash
conoha app env set myserver --app-name supabase-selfhost \
  "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)" \
  "JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)"
```

```
Set POSTGRES_PASSWORD
Set JWT_SECRET
```

`POSTGRES_PASSWORD` はPostgreSQLの全ロールで共有されるパスワード、`JWT_SECRET` はGoTrueとPostgRESTのJWT検証に使用されます。

### 4. デプロイ

```bash
conoha app deploy myserver --app-name supabase-selfhost
```

6つのサービスのイメージをpullするため、初回は数分かかります。

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image supabase/postgres:15.8.1.060 Pulling
 Image supabase/gotrue:v2.170.0 Pulling
 Image supabase/studio:latest Pulling
 Image kong:3.9 Pulling
 Image postgrest/postgrest:v12.2.12 Pulling
 Image supabase/postgres-meta:v0.88.2 Pulling
 ...
 Container supabase-selfhost-db-1 Started
 Container supabase-selfhost-db-1 Healthy
 Container supabase-selfhost-auth-1 Started
 Container supabase-selfhost-rest-1 Started
 Container supabase-selfhost-meta-1 Started
 Container supabase-selfhost-studio-1 Started
Deploy complete.
```

### 5. コンテナ状態の確認

```bash
conoha app status myserver --app-name supabase-selfhost
```

```
NAME                         IMAGE                            STATUS              PORTS
supabase-selfhost-auth-1     supabase/gotrue:v2.170.0         Up About a minute
supabase-selfhost-db-1       supabase/postgres:15.8.1.060     Up About a minute   127.0.0.1:5432->5432/tcp
supabase-selfhost-kong-1     kong:3.9                         Up About a minute   0.0.0.0:8000->8000/tcp
supabase-selfhost-meta-1     supabase/postgres-meta:v0.88.2   Up About a minute
supabase-selfhost-rest-1     postgrest/postgrest:v12.2.12     Up About a minute
supabase-selfhost-studio-1   supabase/studio:latest           Up About a minute   0.0.0.0:3000->3000/tcp
```

6つのサービスすべてが `Up` 状態になっていれば成功です。

---

## 動作確認

### Studio UI

ブラウザで `http://<サーバーIP>:3000` にアクセスすると、Supabase Studioの管理画面が表示されます。Table Editor、SQL Editor、Authentication管理がブラウザから利用できます。

### API Gateway

```bash
# Auth ヘルスチェック
curl http://<サーバーIP>:8000/auth/v1/health
```

```json
{"version":"v2.170.0","name":"GoTrue","description":"GoTrue is a user registration and authentication API"}
```

```bash
# REST API（apikey ヘッダーが必要）
curl -H "apikey: <anon-key>" http://<サーバーIP>:8000/rest/v1/
```

### ログ確認

```bash
conoha app logs myserver --app-name supabase-selfhost
```

各サービスの起動ログがインターリーブで表示されます。特にGoTrueのログでマイグレーション完了が確認できれば、DB接続は正常です。

---

## リソース要件について

Supabase公式ドキュメントでは最低4GBメモリのサーバーが推奨されています。しかし実際にテストしたところ、**ConoHa VPS3 の1GBプラン（g2l-t-1）でも6つのサービスすべてが正常に動作しました**。

開発・検証用途であれば1GBプランで十分です。本番環境やトラフィックが増える場合は、4GBプラン（g2l-t-4）以上を検討してください。

---

## つまずきポイントまとめ

| 問題 | 原因 | 解決策 |
|------|------|--------|
| `supabase/studio:20250317-6be1014` が見つからない | 旧タグがDocker Hubから削除済み | `supabase/studio:latest` に変更 |
| GoTrue/PostgRESTが起動と停止を繰り返す | 内部ロールにパスワード未設定 | init スクリプトで `ALTER ROLE ... WITH PASSWORD` |
| init スクリプトで `-h 127.0.0.1` が接続拒否 | Docker Entrypoint 初期化中はTCPリスナー未起動 | ローカルソケット接続 + `PGPASSWORD` 明示設定に変更 |
| `supabase_admin` のローカルソケット接続が拒否 | Supabase独自 `pg_hba.conf` が `scram-sha-256` 要求 | `PGPASSWORD` を明示的にexport |

---

## まとめ

conoha-cli の `app init` → `app env set` → `app deploy` の3コマンドで、Supabaseのセルフホスト環境をConoHa VPS3上に構築できました。

| アクセス先 | URL |
|---|---|
| Studio UI | `http://<IP>:3000` |
| API Gateway | `http://<IP>:8000` |
| Auth API | `http://<IP>:8000/auth/v1/` |
| REST API | `http://<IP>:8000/rest/v1/` |

Supabaseのセルフホストは公式ドキュメントだけでは分からないPostgreSQLロール認証のハマりポイントがありますが、init スクリプトで解決できます。1GBプランでも動作するため、気軽に試せる環境です。

次回は、このSupabase環境を使って簡単なWebアプリケーションを構築してみたいと思います。PostgRESTの自動生成APIとGoTrueの認証を組み合わせれば、バックエンドのコードをほとんど書かずにアプリを作れるはずです。

サンプルコードはすべて以下のリポジトリで公開しています。

- サンプル: [crowdy/conoha-cli-app-samples/supabase-selfhost](https://github.com/crowdy/conoha-cli-app-samples/tree/main/supabase-selfhost)
- CLI: [crowdy/conoha-cli](https://github.com/crowdy/conoha-cli)

