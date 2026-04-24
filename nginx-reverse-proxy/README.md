# nginx-reverse-proxy

nginx をリバースプロキシとして使い、複数のアプリを1台の VPS で運用するサンプルです。

## 構成

- nginx（リバースプロキシ）
- App 1: Node.js（フロントエンド、`/` でアクセス）
- App 2: Python（API サーバー、`/api/` でアクセス）
- ポート: 80

## このサンプルの位置付け

> **note**: conoha-proxy が Host ベースのルーティングと Let's Encrypt による
> TLS 終端を担うようになったため、**新規プロジェクトでは内側に nginx を置く必要は
> 通常ありません**。conoha-proxy 単体で `https://app.example.com` → app1、
> `https://api.example.com` → app2 のような分離が可能です（複数の `hosts:` を
> 別々のアプリとして登録するか、それぞれ別の `conoha.yml` プロジェクトとして
> 並べる）。
>
> このサンプルは、**1 つの FQDN でパスごと（`/` → app1、`/api/` → app2）に
> 振り分けたい**ようなケースの参考実装として残しています。conoha-proxy が
> nginx をフロントし、nginx がさらに app1/app2 にパスベースで振り分ける
> 二段構成です。

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

`app1` と `app2` は accessory として宣言されているため、blue/green 切替時も
再起動されません。`proxy` (nginx) コンテナのみが新スロットに立ち上がります
— 内側の nginx 設定だけを変更して再デプロイしたい場合に有効な構成です。

## 動作確認

- `https://<あなたの FQDN>/` → App 1（Node.js フロントエンド）
- `https://<あなたの FQDN>/api/hello` → App 2（Python API）
- `https://<あなたの FQDN>/health` → nginx ヘルスチェック
- `https://<あなたの FQDN>/debug/headers` → プロキシ転送ヘッダーの確認

初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

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
