# hono-drizzle-postgresql

Hono と Drizzle ORM を使ったブックマーク管理 REST API です。OpenAPI (Swagger UI) による API ドキュメントを自動生成します。

## 構成

- Node.js 22 + TypeScript
- Hono + @hono/zod-openapi（OpenAPI 自動生成）
- Drizzle ORM（タイプセーフなクエリ）
- PostgreSQL 17
- ポート: 3000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name bookmark-api

# デプロイ
conoha app deploy myserver --app-name bookmark-api
```

## 動作確認

- ブラウザで `http://<サーバーIP>:3000` にアクセスするとブックマーク管理画面が表示されます
- `http://<サーバーIP>:3000/doc` で Swagger UI から API を直接試せます

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | /api/bookmarks | ブックマーク一覧（?tag=&q=&page=&limit=） |
| POST | /api/bookmarks | ブックマーク作成 |
| GET | /api/bookmarks/:id | ブックマーク詳細 |
| PUT | /api/bookmarks/:id | ブックマーク更新 |
| DELETE | /api/bookmarks/:id | ブックマーク削除 |
| GET | /doc | Swagger UI |
| GET | /health | ヘルスチェック |

## カスタマイズ

- `src/db/schema.ts` で Drizzle スキーマを変更
- `src/routes.ts` にルートを追加して機能を拡張
- `drizzle.config.ts` で drizzle-kit によるマイグレーション管理が可能
