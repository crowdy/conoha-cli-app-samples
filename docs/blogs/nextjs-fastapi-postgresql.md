---
title: conoha-cliでNext.js + FastAPI + PostgreSQLのフルスタックアプリをConoHa VPSにワンコマンドデプロイ
tags: Conoha conoha-cli Next.js FastAPI PostgreSQL
author: crowdy
slide: false
---
## はじめに

Next.js（フロントエンド）+ FastAPI（バックエンドAPI）+ PostgreSQL（データベース）の3層構成は、モダンなWebアプリの定番パターンです。しかし、この構成を本番サーバーにデプロイしようとすると、以下のような作業が待っています。

- サーバーにDockerをインストール
- SSH鍵やセキュリティグループの設定
- ソースコードの転送
- `docker compose up` の実行
- Node.jsのビルド環境のセットアップ
- ...

**conoha-cli** を使えば、こうした作業をすべてスキップして、**ローカルにNode.jsやPythonをインストールすることなく**、ワンコマンドでデプロイできます。

ビルドはすべてサーバー上のDockerマルチステージビルドで行われるため、ローカル環境に依存しません。

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli)は、ConoHa VPS3をコマンドラインから操作するCLIツールです。

### 主な機能

- サーバーの作成・削除・一覧表示
- `compose.yml` ベースのアプリデプロイ（`app deploy`）
- コンテナのログ確認・ステータス監視
- 環境変数の安全な注入（`.env.server`）

ポイントは **`app deploy` コマンド**です。ローカルの `compose.yml` と `Dockerfile` があるディレクトリで実行するだけで、ソースコードをサーバーに転送し、Docker Composeでビルド・起動まで一気に行います。

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み（`conoha keypair create` で作成可能）

## 今回デプロイするアプリ

GitHubリポジトリ [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples) に収録されている `nextjs-fastapi-postgresql` サンプルを使います。

企業コーポレートサイト風のデザインで、ニュース記事のCRUD（作成・一覧・詳細・編集・削除）機能を持っています。

### 構成コンポーネント

| サービス | 技術 | 役割 |
|---------|------|------|
| frontend | Next.js 16 + React 19 + Tailwind CSS v4 | SSR/SSGフロントエンド |
| backend | FastAPI + SQLAlchemy + Pydantic | REST API |
| db | PostgreSQL 17 | データベース |

### アーキテクチャ

```
ブラウザ → :80 → [frontend (Next.js)]
                      │
                      │ rewrites /api/* → backend:8000/api/*
                      ▼
                  [backend (FastAPI)]
                      │
                      │ asyncpg
                      ▼
                  [db (PostgreSQL 17)]
```

外部に公開するポートは **80番のみ**。バックエンドAPIへのアクセスはNext.jsのrewrites機能でプロキシされるため、フロントエンドとAPIが同一オリジンで動作します。

## ファイル構成

```
nextjs-fastapi-postgresql/
├── compose.yml          # 3サービス定義
├── frontend/
│   ├── Dockerfile       # node:22 マルチステージビルド
│   ├── package.json
│   ├── next.config.ts   # rewrites設定
│   └── app/             # Next.js App Router
└── backend/
    ├── Dockerfile       # python:3.12-slim
    ├── requirements.txt
    ├── main.py          # FastAPI CRUD + ヘルスチェック
    ├── models.py        # SQLAlchemy モデル
    ├── schemas.py       # Pydantic バリデーション
    └── database.py      # async DB接続
```

## compose.yml

```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "80:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost/api
    depends_on:
      backend:
        condition: service_healthy

  backend:
    build: ./backend
    expose:
      - "8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://appuser:apppass@db:5432/appdb
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]
      interval: 5s
      timeout: 5s
      retries: 5

  db:
    image: postgres:17
    environment:
      - POSTGRES_DB=appdb
      - POSTGRES_USER=appuser
      - POSTGRES_PASSWORD=apppass
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

**ポイント**:
- `depends_on` + `healthcheck` で起動順序を保証（db → backend → frontend）
- backendのヘルスチェックには `python` コマンドを使用（`curl` を追加インストールする必要がない）
- PostgreSQLのデータは名前付きボリューム `db_data` で永続化

## フロントエンドのDockerfile

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```

3段階のマルチステージビルドにより、**ローカルにNode.jsがインストールされていなくてもビルドできます**。サーバー上のDockerが `npm ci` → `next build` をすべて実行するため、開発環境に依存しません。

`output: "standalone"` を使うことで、`node_modules` を含まない軽量なプロダクションイメージが生成されます。

## デプロイ手順

### 1. リポジトリをクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/nextjs-fastapi-postgresql
```

### 2. サーバーを作成

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey --wait
```

2GB RAM（`g2l-t-2`）で十分動作します。

### 3. アプリを初期化

```bash
conoha app init myserver --app-name fullstack-app
```

サーバーにDocker環境がセットアップされます。

### 4. デプロイ

```bash
conoha app deploy myserver --app-name fullstack-app
```

このコマンドひとつで以下が実行されます:

1. ローカルのソースコードをtar.gzに圧縮
2. SSH経由でサーバーに転送
3. サーバー上で `docker compose up -d --build` を実行
4. Node.jsのビルド（`npm ci` + `next build`）
5. Pythonの依存関係インストール（`pip install`）
6. PostgreSQLの起動とテーブル自動作成
7. 全コンテナの起動

### 5. 動作確認

```bash
# コンテナ状態を確認
conoha app status myserver --app-name fullstack-app
```

```text
NAME                                   STATUS         PORTS
nextjs-fastapi-postgresql-frontend-1   Up (healthy)   0.0.0.0:80->3000/tcp
nextjs-fastapi-postgresql-backend-1    Up (healthy)   8000/tcp
nextjs-fastapi-postgresql-db-1         Up (healthy)   5432/tcp
```

3つのコンテナがすべて `healthy` になれば成功です。

ブラウザで `http://<サーバーIP>` にアクセスすると、コーポレートサイト風のトップページが表示されます。

## ローカルビルド不要という利点

今回のデプロイで特に強調したいのは、**ローカルマシンにNode.js、Python、PostgreSQLのいずれもインストールする必要がない**という点です。

| 従来のデプロイ | conoha-cli でのデプロイ |
|--------------|----------------------|
| ローカルでNode.jsをインストール | 不要 |
| ローカルで `npm install` + `npm run build` | 不要（サーバー上のDockerで実行） |
| ローカルでPython仮想環境を構築 | 不要 |
| ビルド成果物をサーバーに転送 | ソースコードをそのまま転送 |
| サーバーでDocker Composeを手動実行 | `conoha app deploy` が自動実行 |

必要なのは `conoha-cli` と `compose.yml` + `Dockerfile` だけです。

この仕組みはNext.jsに限りません。同じリポジトリには [Laravel + MySQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/laravel-mysql)、[Django + PostgreSQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/django-postgresql)、[Rails + PostgreSQL](https://github.com/crowdy/conoha-cli-app-samples/tree/main/rails-postgresql) など30以上のサンプルが収録されており、どれも同じ手順でデプロイできます。

## ハマりポイント

今回のデプロイで特に問題になった点はありませんでした。

強いて言えば、Next.jsの `output: "standalone"` 設定を忘れると、Dockerイメージに `node_modules` が含まれず起動に失敗するので注意が必要です。本サンプルでは最初から設定済みなので、クローンしてそのままデプロイできます。

## まとめ

| 項目 | 内容 |
|------|------|
| デプロイ対象 | Next.js 16 + FastAPI + PostgreSQL 17 |
| 必要コマンド | `app init` + `app deploy` の2つ |
| ローカル環境の要件 | conoha-cli のみ（Node.js/Python不要） |
| 推奨フレーバー | g2l-t-2（2GB RAM） |
| 外部公開ポート | 80 のみ |
| ソースコード | [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples/tree/main/nextjs-fastapi-postgresql) |

フルスタック構成でも、`compose.yml` と `Dockerfile` さえ用意すれば `conoha app deploy` ひとつでデプロイが完了します。ビルドはすべてサーバー上のDockerで実行されるため、ローカル環境を汚す必要がありません。

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)

