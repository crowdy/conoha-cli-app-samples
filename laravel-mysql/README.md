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

DB マイグレーションと APP_KEY 生成はコンテナ起動時に自動実行されます。`db` は accessory として宣言されているため、blue/green 切替時も MySQL は再起動されません。

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスすると投稿一覧ページが表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- `app/Http/Controllers/` にコントローラーを追加
- `resources/views/` に Blade テンプレートを追加
- `database/migrations/` にマイグレーションを追加してスキーマを変更
- 本番環境では `DB_PASSWORD` を `.env.server` で管理
