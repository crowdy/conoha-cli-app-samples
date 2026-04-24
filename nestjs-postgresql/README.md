# nestjs-postgresql

NestJS と PostgreSQL を使ったシンプルな投稿アプリです。TypeORM による CRUD 機能を持ちます。

## 構成

- Node.js 22 + NestJS 11 + TypeScript
- TypeORM + PostgreSQL 17
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

テーブルはアプリ起動時に自動作成されます（TypeORM synchronize）。`db` は accessory として宣言されているため、blue/green 切替時も PostgreSQL は再起動されません。

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスすると投稿一覧ページが表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- `src/` にモジュール・コントローラー・サービスを追加
- `nest g resource <name>` でリソース一式を自動生成
- 本番環境では `DB_PASSWORD` を `.env.server` で管理
- `synchronize: true` は開発用。本番ではマイグレーションを使用
