# go-fiber

Go と Fiber フレームワークで構築した高速 REST API サーバーです。インメモリでメッセージの CRUD を行います。

## 構成

- Go 1.24 + Fiber v2
- ポート: 3000

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name go-api

# デプロイ
conoha app deploy myserver --app-name go-api
```

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスするとメッセージボードが表示されます。

API エンドポイント:
- `GET /api/messages` — メッセージ一覧
- `POST /api/messages` — メッセージ作成（`{"text": "hello"}`）
- `DELETE /api/messages/:id` — メッセージ削除
- `GET /health` — ヘルスチェック

## カスタマイズ

- `main.go` にルートを追加して機能を拡張
- データベースを追加する場合は GORM などの ORM を導入
- バイナリサイズが小さいため起動が非常に高速
