# django-postgresql

Django と PostgreSQL を使ったシンプルな投稿アプリです。Django ORM による CRUD 機能と管理画面を持ちます。

## 構成

- Python 3.12 + Django 5.2
- PostgreSQL 17
- Gunicorn（アプリサーバー）
- ポート: 8000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name django-app

# デプロイ
conoha app deploy myserver --app-name django-app
```

DB マイグレーションはコンテナ起動時に自動実行されます。

## 動作確認

ブラウザで `http://<サーバーIP>:8000` にアクセスすると投稿一覧ページが表示されます。

Django 管理画面は `http://<サーバーIP>:8000/admin/` からアクセスできます（スーパーユーザーの作成が必要）。

## カスタマイズ

- `posts/` アプリを編集して機能を追加
- `python manage.py startapp <name>` で新しいアプリを追加
- `python manage.py createsuperuser` で管理画面のユーザーを作成
- 本番環境では `SECRET_KEY` と `DB_PASSWORD` を `.env.server` で管理
