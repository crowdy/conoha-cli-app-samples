# go-fiber

Go と Fiber フレームワークで構築した高速 REST API サーバーです。インメモリでメッセージの CRUD を行います。

## 構成

- Go 1.24 + Fiber v2
- ポート: 3000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. デプロイ
conoha app deploy myserver
```

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスするとメッセージボードが表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

API エンドポイント:
- `GET /api/messages` — メッセージ一覧
- `POST /api/messages` — メッセージ作成（`{"text": "hello"}`）
- `DELETE /api/messages/:id` — メッセージ削除
- `GET /health` — ヘルスチェック

## カスタマイズ

- `main.go` にルートを追加して機能を拡張
- データベースを追加する場合は GORM などの ORM を導入
- バイナリサイズが小さいため起動が非常に高速
