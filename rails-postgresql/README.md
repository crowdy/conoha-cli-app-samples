# rails-postgresql

Rails と PostgreSQL を使ったシンプルな投稿アプリです。scaffold 相当の CRUD 機能を持ちます。

## 構成

- Ruby 3.3 + Rails 8.0
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
conoha app init myserver --app-name rails-app

# デプロイ
conoha app deploy myserver --app-name rails-app
```

DB マイグレーションはコンテナ起動時に自動実行されます。

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスすると投稿一覧ページが表示されます。

## カスタマイズ

- `app/controllers/` と `app/views/` を編集して機能を追加
- `db/migrate/` に新しいマイグレーションを追加してスキーマを変更
- 本番環境では `compose.yml` の `SECRET_KEY_BASE` と `DB_PASSWORD` を `.env.server` で管理
