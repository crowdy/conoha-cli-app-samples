# nextjs-fastapi-postgresql

Next.js + FastAPI + PostgreSQL を使ったフルスタック企業コーポレートサイトのサンプルです。
ニュース記事の CRUD（作成・一覧・詳細・編集・削除）機能を備えています。

## スクリーンショット

トップページはヒーローセクション、サービス一覧、ニュース、企業情報のセクションで構成されています。
ニュースセクションは FastAPI + PostgreSQL で動的に管理され、管理画面から投稿・編集・削除が可能です。

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| フロントエンド | Next.js (App Router, Server Components) | 16 |
| UI | React + Tailwind CSS | 19 / v4 |
| バックエンド API | FastAPI + Uvicorn | 0.135 |
| ORM | SQLAlchemy (async) + asyncpg | 2.0 |
| バリデーション | Pydantic | 2.12 |
| データベース | PostgreSQL | 17 |
| コンテナ | Docker マルチステージビルド | - |

## アーキテクチャ

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

- **frontend**: Next.js の `output: "standalone"` でビルド。Server Components から直接 `http://backend:8000` を fetch
- **backend**: FastAPI で REST API を提供。起動時にテーブルを自動作成
- **db**: PostgreSQL 17。データは Docker ボリューム `db_data` に永続化
- 外部公開ポートは **80 のみ**（frontend）。backend と db は Docker 内部ネットワークのみ

## ディレクトリ構成

```
nextjs-fastapi-postgresql/
├── compose.yml                 # 3サービス定義（frontend, backend, db）
├── README.md
├── frontend/
│   ├── Dockerfile              # node:22 マルチステージビルド（deps → build → runner）
│   ├── package.json
│   ├── package-lock.json
│   ├── next.config.ts          # rewrites で /api/** → backend:8000 にプロキシ
│   ├── tsconfig.json
│   ├── postcss.config.mjs
│   ├── public/
│   └── app/
│       ├── layout.tsx          # 共通レイアウト（Header + Footer）
│       ├── page.tsx            # トップページ（Hero, Services, News, Company）
│       ├── globals.css         # Tailwind CSS v4 テーマ定義
│       ├── lib/
│       │   ├── types.ts        # Post 型定義
│       │   └── api.ts          # API ヘルパー（getPosts, getPost）
│       ├── components/
│       │   ├── Header.tsx      # ナビゲーション（レスポンシブ対応）
│       │   ├── Footer.tsx      # フッター（4カラムリンク）
│       │   ├── PostForm.tsx    # ニュース投稿・編集フォーム（エラーハンドリング付き）
│       │   └── DeleteButton.tsx # 削除確認ダイアログ付きボタン
│       └── news/
│           ├── page.tsx        # ニュース一覧
│           ├── new/page.tsx    # 新規投稿
│           └── [id]/
│               ├── page.tsx    # ニュース詳細
│               └── edit/page.tsx # 編集
└── backend/
    ├── Dockerfile              # python:3.12-slim + uvicorn
    ├── requirements.txt
    ├── main.py                 # FastAPI アプリ（CRUD エンドポイント + ヘルスチェック）
    ├── models.py               # SQLAlchemy モデル（Post）
    ├── schemas.py              # Pydantic スキーマ（バリデーション付き）
    └── database.py             # async engine / session 設定
```

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/health` | ヘルスチェック |
| GET | `/api/posts` | ニュース一覧を取得 |
| GET | `/api/posts/{id}` | ニュース詳細を取得 |
| POST | `/api/posts` | ニュースを作成 |
| PUT | `/api/posts/{id}` | ニュースを更新 |
| DELETE | `/api/posts/{id}` | ニュースを削除 |

リクエスト/レスポンスは Pydantic でバリデーションされます（タイトル: 1〜200文字、本文: 1文字以上）。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. デプロイ
conoha app deploy myserver
```

テーブル作成は FastAPI 起動時に自動実行されます（Alembic 不要）。`backend` と `db` は accessory として宣言されているため、blue/green 切替時も再起動されません — `frontend` のみが新スロットに立ち上がります。

> **注意**: 現在の `compose.yml` は `NEXT_PUBLIC_API_URL=http://localhost/api` を frontend に渡しています。これはサーバーサイドの Next.js rewrite 経由で `backend:8000/api` にプロキシされる前提です。ブラウザ側 JS から直接呼ばれるケースは動きません（pre-existing issue、本 PR の対象外）。

## 動作確認

```bash
# コンテナ状態を確認
conoha app status myserver

# ログを確認
conoha app logs myserver

# API をテスト（proxy 経由で frontend → backend にルーティング）
# `nextjs-fastapi-postgresql.example.com` は conoha.yml の `hosts:` に
# 合わせて自分の FQDN に置き換えてください。
curl https://nextjs-fastapi-postgresql.example.com/api/health
curl https://nextjs-fastapi-postgresql.example.com/api/posts
curl -X POST https://nextjs-fastapi-postgresql.example.com/api/posts \
  -H 'Content-Type: application/json' \
  -d '{"title":"テスト投稿","body":"本文です。"}'
```

ブラウザで `https://<あなたの FQDN>` にアクセスするとコーポレートサイト風のトップページが表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## ページ構成

| パス | 説明 |
|------|------|
| `/` | トップページ（Hero、サービス一覧、ニュース、企業情報、採用CTA） |
| `/news` | ニュース一覧（投稿・編集・削除） |
| `/news/new` | ニュース新規投稿 |
| `/news/{id}` | ニュース詳細 |
| `/news/{id}/edit` | ニュース編集 |

## カスタマイズ

### バックエンド
- `backend/models.py` にモデルを追加してスキーマを変更
- `backend/main.py` にエンドポイントを追加
- `backend/schemas.py` でバリデーションルールを変更

### フロントエンド
- `frontend/app/page.tsx` でトップページのセクションを編集
- `frontend/app/components/` にコンポーネントを追加
- `frontend/app/globals.css` の `@theme` でカラーテーマを変更
- `frontend/app/news/` にニュースのカテゴリ機能などを追加

### 本番環境
- `DB_PASSWORD` は `.env.server` で管理（デプロイ時に自動コピーされます）
- `compose.yml` の環境変数を `.env.server` で上書き可能
