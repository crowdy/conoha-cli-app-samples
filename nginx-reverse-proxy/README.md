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
- `http://<サーバーIP>/debug/headers` → プロキシ転送ヘッダーの確認

## リバースプロキシ機能

`nginx.conf` には以下のリバースプロキシ設定が含まれています。

### Forwarded Headers

バックエンドにクライアント情報を転送するヘッダー群です。

| ヘッダー | 内容 |
|---------|------|
| `X-Real-IP` | クライアントの実 IP アドレス |
| `X-Forwarded-For` | プロキシチェーン全体の IP リスト |
| `X-Forwarded-Proto` | クライアントが使用したプロトコル（http/https） |
| `X-Forwarded-Host` | クライアントがリクエストしたホスト名 |
| `X-Forwarded-Port` | クライアントがアクセスしたポート番号 |
| `X-Request-ID` | リクエストごとのユニーク ID（トレーシング用） |

`/debug/headers` エンドポイントでバックエンドが受け取ったヘッダーを確認できます。

### Security Headers

すべてのレスポンスに付与されるセキュリティヘッダーです。

- `X-Content-Type-Options: nosniff` — MIME タイプスニッフィング防止
- `X-Frame-Options: SAMEORIGIN` — クリックジャッキング防止
- `X-XSS-Protection: 1; mode=block` — XSS フィルター有効化
- `Referrer-Policy: strict-origin-when-cross-origin` — リファラー情報の制御
- `X-Served-By: nginx-reverse-proxy-demo` — 経由プロキシの識別

### Rate Limiting

IP アドレスごとにリクエストレートを制限します。

- フロントエンド（`/`）: 10 リクエスト/秒、バースト 20
- API（`/api/`）: 5 リクエスト/秒、バースト 10

### IP Filtering

`geo $blocked_ip` ブロックで IP アドレスやサブネット単位のアクセスブロックが可能です。

```nginx
geo $blocked_ip {
    default 0;
    192.168.100.0/24 1;   # このサブネットをブロック
    10.0.0.5 1;            # この IP をブロック
}
```

### 機密パスのブロック

`/.env`、`/.git`、`/.htpasswd` へのアクセスは 404 を返します。

### CORS

`/api/` パスには CORS ヘッダーが付与されます。`OPTIONS` リクエストにはプリフライト応答（204）を返します。

## カスタマイズ

- `nginx.conf` に `location` ブロックを追加して新しいアプリをルーティング
- `compose.yml` に新しいサービスを追加
- HTTPS が必要な場合は Let's Encrypt + certbot を追加
- 本番では `server_name` にドメインを設定
