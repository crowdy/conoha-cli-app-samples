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

`db` は accessory として宣言されているため、blue/green 切替時も PostgreSQL は再起動されません。

## 動作確認

- ブラウザで `https://<あなたの FQDN>` にアクセスするとブックマーク管理画面が表示されます
- `https://<あなたの FQDN>/doc` で Swagger UI から API を直接試せます
- 初回は Let's Encrypt 証明書発行に数十秒かかる場合があります

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
