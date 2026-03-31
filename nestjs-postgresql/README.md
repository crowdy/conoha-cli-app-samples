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

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name nestjs-app

# デプロイ
conoha app deploy myserver --app-name nestjs-app
```

テーブルはアプリ起動時に自動作成されます（TypeORM synchronize）。

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると投稿一覧ページが表示されます。

## カスタマイズ

- `src/` にモジュール・コントローラー・サービスを追加
- `nest g resource <name>` でリソース一式を自動生成
- 本番環境では `DB_PASSWORD` を `.env.server` で管理
- `synchronize: true` は開発用。本番ではマイグレーションを使用
