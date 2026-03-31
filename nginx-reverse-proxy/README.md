# nginx-reverse-proxy

nginx をリバースプロキシとして使い、複数のアプリを1台の VPS で運用するサンプルです。

## 構成

- nginx（リバースプロキシ）
- App 1: Node.js（フロントエンド、`/` でアクセス）
- App 2: Python（API サーバー、`/api/` でアクセス）
- ポート: 80

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name reverse-proxy

# デプロイ
conoha app deploy myserver --app-name reverse-proxy
```

## 動作確認

- `http://<サーバーIP>/` → App 1（Node.js フロントエンド）
- `http://<サーバーIP>/api/hello` → App 2（Python API）
- `http://<サーバーIP>/health` → nginx ヘルスチェック

## カスタマイズ

- `nginx.conf` に `location` ブロックを追加して新しいアプリをルーティング
- `compose.yml` に新しいサービスを追加
- HTTPS が必要な場合は Let's Encrypt + certbot を追加
- 本番では `server_name` にドメインを設定
