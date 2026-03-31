# rust-actix-web

Rust と Actix-web で構築した高速 REST API サーバーです。インメモリでメッセージの CRUD を行います。

## 構成

- Rust 1.86 + Actix-web 4
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
conoha app init myserver --app-name rust-api

# デプロイ
conoha app deploy myserver --app-name rust-api
```

初回ビルドは Rust コンパイルに数分かかります。2回目以降はキャッシュで高速化されます。

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスするとメッセージボードが表示されます。

API エンドポイント:
- `GET /api/messages` — メッセージ一覧
- `POST /api/messages` — メッセージ作成（`{"text": "hello"}`）
- `DELETE /api/messages/:id` — メッセージ削除
- `GET /health` — ヘルスチェック

## カスタマイズ

- `src/main.rs` にルートを追加して機能を拡張
- データベースを追加する場合は Diesel や SQLx を導入
- バイナリサイズが非常に小さくメモリ効率が高い
