# laravel-mysql

Laravel と MySQL を使ったシンプルな投稿アプリです。Eloquent ORM による CRUD 機能を持ちます。

## 構成

- PHP 8.4 + Laravel 13
- MySQL 8.4
- ポート: 80

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name laravel-app

# デプロイ
conoha app deploy myserver --app-name laravel-app
```

DB マイグレーションと APP_KEY 生成はコンテナ起動時に自動実行されます。

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスすると投稿一覧ページが表示されます。

## カスタマイズ

- `app/Http/Controllers/` にコントローラーを追加
- `resources/views/` に Blade テンプレートを追加
- `database/migrations/` にマイグレーションを追加してスキーマを変更
- 本番環境では `DB_PASSWORD` を `.env.server` で管理
