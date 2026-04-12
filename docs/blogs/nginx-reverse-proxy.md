---
title: conoha-cliでnginxリバースプロキシをConoHa VPSにワンコマンドデプロイ — 教育用プロキシ設定サンプル
tags: nginx Docker Conoha conoha-cli reverseproxy
author: crowdy
slide: false
---
## はじめに

「リバースプロキシって何をしてるの？」「X-Forwarded-For とか X-Real-IP って何？」——Webインフラを学ぶとき、nginx のリバースプロキシ設定は避けて通れないテーマです。しかし、設定ファイルを読むだけでは理解しにくく、実際にリクエストを飛ばしてヘッダーやレスポンスを確認して初めて「なるほど」と腹落ちするものです。

この記事では、**教育用に設計したnginxリバースプロキシのサンプル**を、ConoHa VPS3上に `conoha app deploy` ワンコマンドでデプロイする方法を紹介します。

単なるプロキシ転送だけでなく、以下のような実務で頻出するリバースプロキシ機能を1つの `nginx.conf` にまとめています。

- **Forwarded Headers**（X-Real-IP、X-Forwarded-For など）
- **セキュリティヘッダー**（X-Content-Type-Options、X-Frame-Options など）
- **Rate Limiting**（IPごとのリクエスト制限）
- **IP Filtering**（特定IPのブロック）
- **機密パスのブロック**（`.env`、`.git` へのアクセス拒否）
- **CORS設定**
- **ヘッダー確認用デバッグエンドポイント**

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

### 主な機能

- **サーバー管理**: VPSの作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリをVPSにデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認
- **環境変数管理**: `app env set` でセキュアに環境変数を注入

`app deploy` コマンドは内部でDockerとDocker Composeを自動セットアップし、ディレクトリをgit push形式でVPSへ転送してコンテナを起動します。SSHキーさえ設定すれば、コマンド1本でデプロイが完了します。

---

## 構成

| サービス | 技術 | 役割 |
|---------|------|------|
| proxy | nginx:alpine | リバースプロキシ（ポート80） |
| app1 | Node.js 24 (Alpine) | フロントエンド（`/`） |
| app2 | Python 3.13 (slim) | APIサーバー（`/api/`） |

### アーキテクチャ

```
ブラウザ → :80 → [nginx (proxy)]
                     ├── /          → [app1 (Node.js :3000)]
                     ├── /api/      → [app2 (Python :8000)]
                     ├── /debug/headers → [app2 (ヘッダー確認)]
                     ├── /health    → nginx直接応答
                     └── /.env, /.git → 404 ブロック
```

nginx が全リクエストを受け、パスに応じて適切なバックエンドにルーティングします。

---

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み（`conoha keypair create` で作成可能）

---

## ファイル構成

```
nginx-reverse-proxy/
├── compose.yml       # 3サービス定義
├── nginx.conf        # リバースプロキシ設定（本記事のメイン）
├── app1/
│   ├── Dockerfile    # Node.js 24 Alpine
│   └── app.js        # フロントエンドHTML + ヘッダー確認UI
└── app2/
    ├── Dockerfile    # Python 3.13 slim
    └── app.py        # APIサーバー + /debug/headers エンドポイント
```

---

## nginx.conf — リバースプロキシ設定の詳細解説

この `nginx.conf` が本記事のメインコンテンツです。実務で頻出するリバースプロキシの設定パターンを1つのファイルにまとめています。

### Rate Limiting

```nginx
limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=api:10m rate=5r/s;
```

IPアドレスごとにリクエストレートを制限します。フロントエンドは秒間10リクエスト、APIはより厳しく秒間5リクエストに設定しています。`$binary_remote_addr` を使うことで、文字列IPより省メモリで管理できます。

```nginx
location / {
    limit_req zone=general burst=20 nodelay;
    ...
}

location /api/ {
    limit_req zone=api burst=10 nodelay;
    ...
}
```

`burst` は制限超過時の待機列サイズ、`nodelay` はバースト分を即座に処理する設定です。

### IP Filtering

```nginx
geo $blocked_ip {
    default 0;
    # 192.168.100.0/24 1;   # example: block this subnet
    # 10.0.0.5 1;            # example: block single IP
}

server {
    if ($blocked_ip) {
        return 403;
    }
}
```

`geo` ディレクティブでIPアドレスやサブネット単位のブロックリストを定義します。コメントアウトを外すだけで有効化できます。

### Forwarded Headers

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;
proxy_set_header X-Request-ID      $request_id;
```

| ヘッダー | 説明 |
|---------|------|
| `X-Real-IP` | クライアントの実IPアドレス |
| `X-Forwarded-For` | プロキシチェーン全体のIPリスト。CDNやロードバランサーが前段にある場合、カンマ区切りで追加される |
| `X-Forwarded-Proto` | クライアントが使用したプロトコル（http/https）。バックエンドでHTTPS判定に利用 |
| `X-Forwarded-Host` | クライアントがリクエストしたホスト名 |
| `X-Forwarded-Port` | クライアントがアクセスしたポート番号 |
| `X-Request-ID` | nginxが自動生成するリクエスト固有のID。ログ追跡やマイクロサービス間のトレーシングに利用 |

### Security Headers

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Served-By "nginx-reverse-proxy-demo" always;
```

| ヘッダー | 効果 |
|---------|------|
| `X-Content-Type-Options: nosniff` | ブラウザのMIMEタイプスニッフィングを防止 |
| `X-Frame-Options: SAMEORIGIN` | 他サイトからの `<iframe>` 埋め込みを防止（クリックジャッキング対策） |
| `X-XSS-Protection: 1; mode=block` | ブラウザのXSSフィルターを有効化 |
| `Referrer-Policy` | リファラー情報の送信ポリシーを制御 |
| `X-Served-By` | どのプロキシを経由したか識別するカスタムヘッダー |

### CORS

```nginx
location /api/ {
    add_header Access-Control-Allow-Origin  "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;

    if ($request_method = OPTIONS) {
        return 204;
    }
}
```

APIパスにCORSヘッダーを付与し、異なるオリジンからのJavaScriptリクエストを許可します。`OPTIONS` リクエスト（プリフライト）には `204 No Content` で即座に応答します。

### 機密パスのブロック

```nginx
location ~ /\.(env|git|htpasswd) {
    return 404;
}
```

`.env`（環境変数ファイル）、`.git`（リポジトリ情報）、`.htpasswd`（認証ファイル）へのアクセスをブロックします。デプロイ時にこれらのファイルが意図せず公開されるリスクを防ぎます。

### ヘッダー確認用デバッグエンドポイント

```nginx
location /debug/headers {
    proxy_pass http://app2;
    # ... 全Forwarded Headersを転送
}
```

バックエンド（Python）がリクエストヘッダーをJSON形式で返します。**プロキシが何を転送しているのか**を実際に確認できる教育用エンドポイントです。

---

## compose.yml

```yaml
services:
  proxy:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app1
      - app2

  app1:
    build: ./app1

  app2:
    build: ./app2
```

nginx の設定ファイルは `volumes` でリードオンリーマウントしています。`depends_on` により、app1 と app2 が先に起動してから nginx が起動します。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/nginx-reverse-proxy
```

### 2. サーバー作成（既存サーバーがあればスキップ）

```bash
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey --wait
```

1GB RAM（`g2l-t-1`）で十分動作します。

### 3. アプリ初期化

```bash
conoha app init myserver --app-name reverse-proxy
```

```
Initializing app "reverse-proxy" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
==> Installing post-receive hook...
==> Done!
```

### 4. デプロイ

```bash
conoha app deploy myserver --app-name reverse-proxy
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image reverse-proxy-app1 Building
 Image reverse-proxy-app2 Building
 ...
 Container reverse-proxy-app1-1 Started
 Container reverse-proxy-app2-1 Started
 Container reverse-proxy-proxy-1 Started
Deploy complete.
```

---

## 動作確認

### コンテナ状態

```bash
conoha app status myserver --app-name reverse-proxy
```

```
NAME                      IMAGE                  STATUS        PORTS
reverse-proxy-app1-1      reverse-proxy-app1     Up            3000/tcp
reverse-proxy-app2-1      reverse-proxy-app2     Up            8000/tcp
reverse-proxy-proxy-1     nginx:alpine           Up            0.0.0.0:80->80/tcp
```

### 各エンドポイントの確認

**フロントエンド**（App 1 → Node.js）:

```bash
$ curl -sI http://<サーバーIP>/

X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
X-Served-By: nginx-reverse-proxy-demo
```

セキュリティヘッダーが付与されていることが確認できます。

**API**（App 2 → Python）:

```bash
$ curl -sI http://<サーバーIP>/api/hello

Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

CORSヘッダーが付与されています。

**ヘッダーデバッグ** — プロキシが転送するヘッダーの可視化:

```bash
$ curl -s http://<サーバーIP>/debug/headers | python3 -m json.tool
```

```json
{
    "headers": {
        "Host": "133.88.116.147",
        "X-Real-IP": "210.172.128.230",
        "X-Forwarded-For": "210.172.128.230",
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "133.88.116.147",
        "X-Forwarded-Port": "80",
        "X-Request-ID": "396ca3a7623519ee9b914661d1292f5d",
        "User-Agent": "curl/8.5.0",
        "Accept": "*/*"
    }
}
```

自分のIPアドレスが `X-Real-IP` と `X-Forwarded-For` に入っていること、リクエストごとにユニークな `X-Request-ID` が生成されていることが確認できます。

**機密パスのブロック**:

```bash
$ curl -sI http://<サーバーIP>/.env
HTTP/1.1 404 Not Found

$ curl -sI http://<サーバーIP>/.git
HTTP/1.1 404 Not Found
```

`.env` や `.git` へのアクセスはブロックされています。

**ヘルスチェック**:

```bash
$ curl -s http://<サーバーIP>/health
{"status":"ok"}
```

---

## 機能一覧

| 機能 | 説明 | 確認方法 |
|------|------|----------|
| X-Real-IP / X-Forwarded-For | クライアントの実IPをバックエンドに転送 | `/debug/headers` で確認 |
| X-Forwarded-Proto/Host/Port | プロキシ経由情報をバックエンドに転送 | `/debug/headers` で確認 |
| X-Request-ID | リクエストごとのユニークID（トレーシング用） | `/debug/headers` で確認 |
| Security Headers | X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy | レスポンスヘッダーで確認 |
| X-Served-By | カスタムヘッダー（どのプロキシ経由か表示） | レスポンスヘッダーで確認 |
| Rate Limiting | フロント 10r/s、API 5r/s に制限 | `limit_req_zone` 設定 |
| IP Blocking | `geo $blocked_ip` でIP/サブネット単位でブロック可能 | nginx.conf で有効化可能 |
| 機密パスブロック | `/.env`, `/.git`, `/.htpasswd` へのアクセスを404で拒否 | `/.env` → 404 で確認 |
| CORS | `/api/` パスにCORSヘッダー付与 | レスポンスヘッダーで確認 |
| Headers Debug | `/debug/headers` でプロキシ転送ヘッダーを可視化 | JSON出力で確認 |

---

## 教育用として使うポイント

このサンプルは以下のような学習シナリオで活用できます。

### 1. Forwarded Headersの理解

`/debug/headers` にアクセスして、プロキシが何を転送しているかを実際に確認できます。VPN経由やモバイルからアクセスすると `X-Real-IP` が変わることを体験できます。

### 2. セキュリティヘッダーの効果

ブラウザのDevToolsでレスポンスヘッダーを確認し、各ヘッダーがどのような攻撃を防ぐのかを学べます。ヘッダーを1つずつコメントアウトして、ブラウザの挙動がどう変わるか試してみるのも有効です。

### 3. Rate Limitingの体験

```bash
# 連続リクエストを送信して制限を体験
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" http://<IP>/api/hello; done
```

制限を超えると `503 Service Temporarily Unavailable` が返ります。

### 4. IP Filteringのテスト

`nginx.conf` の `geo $blocked_ip` に自分のIPを追加し、再デプロイすることでブロックの動作を確認できます。

---

## まとめ

`conoha app init` → `conoha app deploy` の2コマンドで、教育用のnginxリバースプロキシ環境をConoHa VPS3上に構築できました。

| アクセス先 | URL |
|---|---|
| フロントエンド（Node.js） | `http://<IP>/` |
| API（Python） | `http://<IP>/api/hello` |
| ヘッダー確認 | `http://<IP>/debug/headers` |
| ヘルスチェック | `http://<IP>/health` |

リバースプロキシの設定は読むだけでは理解しにくいですが、実際にデプロイしてリクエストを飛ばし、ヘッダーの変化を目で見ることで格段に理解が深まります。ぜひ手元でデプロイして試してみてください。

サンプルのソースコードは以下で公開しています。

https://github.com/crowdy/conoha-cli-app-samples/tree/main/nginx-reverse-proxy

他にもWordPress、Strapi、Next.js + FastAPI、Outline、Quickwit + OpenTelemetryなど30種類以上のサンプルが揃っていますので、ぜひ試してみてください。

## 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0?from=notice)

