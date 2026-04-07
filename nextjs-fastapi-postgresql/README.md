# nextjs-fastapi-postgresql

Next.js と FastAPI と PostgreSQL を使ったシンプルな投稿アプリです。SQLAlchemy による CRUD 機能を持ちます。

## 構成

- Next.js 16（React 19, App Router, Tailwind CSS v4）
- FastAPI（Python 3.12, SQLAlchemy, Pydantic）
- PostgreSQL 17
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
conoha app init myserver --app-name nextjs-fastapi-app

# デプロイ
conoha app deploy myserver --app-name nextjs-fastapi-app
```

テーブル作成は FastAPI 起動時に自動実行されます。

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスすると投稿一覧ページが表示されます。

## カスタマイズ

- `backend/models.py` にモデルを追加してスキーマを変更
- `backend/main.py` にエンドポイントを追加
- `frontend/app/` にページやコンポーネントを追加
- 本番環境では `DB_PASSWORD` を `.env.server` で管理
