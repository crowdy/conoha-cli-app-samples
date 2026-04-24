# express-mongodb

Express.js と MongoDB を使ったシンプルな投稿アプリです。Mongoose による CRUD 機能を持ちます。

## 構成

- Node.js 22 + Express.js 5 (web サービス — blue/green 対象)
- MongoDB 8 (`db` accessory — blue/green 切替時も停止せず永続)
- ポート: 3000 (proxy 経由で HTTPS 終端)

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

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスすると投稿一覧ページが表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- `app.js` にルートを追加して機能を拡張
- `views/` に EJS テンプレートを追加
- MongoDB は認証なしで起動するため、本番環境では認証設定を追加し、`conoha app env set` で `MONGO_URL` を更新してください

## accessories について

`conoha.yml` の `accessories: [db]` 宣言により、`db` サービスは blue/green デプロイで再起動されません。web コンテナのみが新スロットに立ち上がり、MongoDB の接続とデータはデプロイ越しに維持されます。スキーマ migration を走らせたい場合は web コンテナの entrypoint で実施してください。
