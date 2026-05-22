---
title: conoha-cli と Cloudflare Origin CA で個人ダッシュボードを ConoHa VPS にデプロイした話
tags: Conoha conoha-cli Cloudflare Caddy Go
author: crowdy
slide: false
---
### はじめに

ブラウザの新しいタブを開くたびに「今日の予定はなんだっけ」「今何時だっけ」「次の予定まであと何分？」と確認するのに、複数のアプリを行き来していませんか。

この記事では、**1 つの画面で時計・天気・複数アカウントのカレンダー予定・自作カウントダウン・ショートカットを集約する個人ダッシュボード**を作り、`conoha-cli` で ConoHa VPS にデプロイし、Cloudflare で HTTPS 化した手順を紹介します。

サンプル: <https://github.com/crowdy/conoha-cli-app-samples/tree/main/personal-dashboard>

### 何を作ったか

シングルページ構成の個人ダッシュボードです。

```
┌──────────────────────────────────────────┐
│           MY COMPANY GROUP        🌙     │ ← ブランド名は .env で変更可
│                                          │
│              17:08                       │ ← 1 秒ごとに更新する大きな時計
│         2026年5月13日 水曜日                │
│  ☁ 渋谷区 23° 晴れ → 25°/15° 晴れ           │ ← 気象庁 API
│                                          │
│  カウントダウン                  + 追加     │
│   05/13 17:20  [あと 11 分]  GYM         │ ← ≤10 分で点滅 / ≤1h 黄 / 経過は赤
│                                          │
│  今日の予定                      🔄 更新   │
│   16:00-17:45 [進行中(残36分)] 打合せ      │ ← Outlook + 複数 Google を合成
│   18:00-18:00 [あと 51 分]  自宅お迎え      │
│                                          │
│  明日の予定                              │
│   11:00-11:15 [あと 18 時間] レビュー      │
│                                          │
│  SHORTCUTS                               │
│   [Slack][Mail][Tel][...]                │
└──────────────────────────────────────────┘
```

中心となる UX は「残時間に応じた色変化」です。

- 残り 1 時間以下: 黄色
- 残り 10 分以下: 黄 ↔ オレンジで点滅
- 経過: 赤色

### スタック

| レイヤ | 採用技術 | 理由 |
|---|---|---|
| バックエンド | Go 1.26 | 単一バイナリにビルドできる |
| DB | SQLite (`modernc.org/sqlite`) | CGO 不要、ファイル 1 つ |
| フロントエンド | Next.js 14 静的書き出し | 動的データは API 経由なので SSR 不要 |
| バンドル | `go:embed` で静的ファイル埋め込み | バイナリ 1 つで配布可能 |
| カレンダー | Microsoft Graph + Google Calendar API | refresh_token を `.env` に置く |
| 天気 | 気象庁 (JMA) 無料 JSON | API キー不要 |
| TLS | Cloudflare Origin CA + Caddy | 後述 |

`web/out/` を `api/internal/webfs/embed/` にコピーし、Go の `//go:embed all:embed` で取り込みます。完成バイナリは約 17 MB、これに `.env` と `data/` ディレクトリだけあれば動きます。

### conoha-cli でのデプロイ

ConoHa VPS3 上に Docker でデプロイします。本サンプルはサブドメインを 1 つに固定する **no-proxy モード** を使います（conoha-proxy の blue/green は使わず、Caddy が直接 80/443 を握る構成）。

#### 1. VPS 作成

Docker プリインストール済みイメージを選ぶと初期構築が一切不要です。

```bash
conoha server create \
  --name dashboard-server \
  --flavor f2a77529-1815-43a2-bc14-1f3f6b09079c \
  --image  722c231f-3f61-4e79-a5a6-c70d6c9ea908 \
  --key-name my-key \
  --security-group default \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --no-input --yes --wait
```

`IPv4v6-Web` を入れておくのが地味に重要で、これ無しだと 80/443 が外から届きません。

#### 2. アプリ初期化とデプロイ

```bash
conoha app init  dashboard-server --app-name dashboard --no-proxy
conoha app deploy dashboard-server --app-name dashboard --no-proxy
```

`conoha app deploy` がカレントディレクトリを tar.gz に固めて転送し、サーバー側で `docker compose up -d --build` を実行します。Dockerfile はマルチステージで Next.js ビルド → Go ビルド → Alpine ランタイムの順に進み、最終イメージには 17 MB のバイナリと `ca-certificates` だけが入ります。

```dockerfile
FROM node:20-alpine AS web-builder
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:alpine AS go-builder
WORKDIR /src
COPY api/go.mod api/go.sum ./api/
RUN cd api && go mod download
COPY api/ ./api/
COPY --from=web-builder /src/web/out/ ./api/internal/webfs/embed/
RUN cd api && CGO_ENABLED=0 GOOS=linux \
    go build -tags timetzdata -ldflags="-s -w" \
    -o /out/dashboard ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=go-builder /out/dashboard /app/dashboard
EXPOSE 8080
ENTRYPOINT ["/app/dashboard"]
```

ここまでで `http://<VPS の IP>/api/health` が `{"ok":true}` を返すようになります。

### Cloudflare ドメインで HTTPS 化（ここが本題）

公開ドメインが Cloudflare 配下にある場合、A レコードを VPS に向けて proxied=ON にすると、CF はオリジンに対しても HTTPS で接続します。オリジン (VPS) に証明書がないと `521 Web server is down` を返してしまうので、オリジンにも TLS 終端が必要です。

選択肢は 3 つ:

| 方式 | 工数 | 備考 |
|---|---|---|
| CF SSL モードを Flexible に | 設定変更のみ | 2024 年以降は新規ゾーンの UI から消えつつある。CF↔オリジンが平文 |
| Let's Encrypt DNS-01 (Caddy + `caddy-dns/cloudflare`) | 中 | 90 日 cert を自動更新。Caddy のカスタムビルドが必要 |
| **Cloudflare Origin CA cert** | 中 | 15 年 cert、CF だけが信頼する。Caddy の標準ビルドで OK |

今回は **Origin CA cert** を選びました。理由は単純で、

- 15 年有効なので運用上の自動更新を考えなくて良い
- Caddy のカスタムビルドが要らない（DNS challenge プラグイン不要）
- CF プロキシ前提なら、cert がパブリック CA で署名されている必要がない

#### Origin CA cert の発行

`SSL and Certificates: Edit` 権限を持つ API トークンが必要です。トークンを `CF_API_TOKEN` に入れて、次のスクリプトを実行します。

```bash
#!/usr/bin/env bash
set -euo pipefail
HOSTNAME="${1:?usage: $0 <hostname>}"
mkdir -p ./certs && chmod 700 ./certs

openssl genrsa -out "./certs/${HOSTNAME}.key" 2048
openssl req -new -key "./certs/${HOSTNAME}.key" -out "./certs/${HOSTNAME}.csr" \
  -subj "/CN=${HOSTNAME}"

CSR=$(jq -Rs . < "./certs/${HOSTNAME}.csr")
curl -sS -X POST \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/certificates" \
  --data "{\"hostnames\":[\"$HOSTNAME\"],\"requested_validity\":5475,\"request_type\":\"origin-rsa\",\"csr\":$CSR}" \
  | jq -r '.result.certificate' > "./certs/${HOSTNAME}.crt"
```

5475 日 = 15 年。レスポンスから cert 部分だけ取り出して `.crt` に保存します。

サンプル本体には [`scripts/issue-cf-origin-cert.sh`](https://github.com/crowdy/conoha-cli-app-samples/blob/main/personal-dashboard/scripts/issue-cf-origin-cert.sh) として同等のものを置いています。

#### VPS への配置と Caddy 設定

```bash
ssh $VPS 'mkdir -p /etc/caddy/certs && chmod 700 /etc/caddy/certs'
scp certs/dashboard.example.com.{crt,key} $VPS:/etc/caddy/certs/
ssh $VPS 'chmod 644 /etc/caddy/certs/*.crt; chmod 600 /etc/caddy/certs/*.key'
```

`docker-compose.yml` に Caddy サービスを足し、`/etc/caddy/certs` をコンテナにマウントします。

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - /etc/caddy/certs:/etc/caddy/certs:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web
  web:
    build: .
    restart: unless-stopped
    expose: ["8080"]
    # ... (環境変数は省略)
```

Caddyfile はシンプルです。

```caddy
dashboard.example.com {
    tls /etc/caddy/certs/dashboard.example.com.crt \
        /etc/caddy/certs/dashboard.example.com.key
    reverse_proxy web:8080
    encode gzip zstd
}
```

`tls` ディレクティブにファイルパスを渡すと Caddy は ACME を試みず、与えられた cert をそのまま使います。Caddy はデフォルトで HTTP → HTTPS リダイレクトと HTTP/3 (`alt-svc`) を自動で有効化します。

#### DNS の最終調整

CF 側で A レコードを VPS の IP に向け、proxied=ON にすれば完了です。

```bash
curl -X PATCH \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$ID" \
  --data '{"type":"A","content":"<VPS の IP>","proxied":true}'
```

完成した TLS チェーンはこうなります。

```
Browser  ── HTTPS ──▶ Cloudflare edge (Universal SSL)
                            │
                            │ HTTPS (Full Strict が CF Origin CA を検証)
                            ▼
                      Caddy (VPS 上, 15 年 cert)
                            │ HTTP (compose 内部ネットワーク)
                            ▼
                       Go バイナリ → SQLite
```

`https://<your-domain>/api/health` が `{"ok":true}` を返したら成功です。

### ハマりポイント

- **`go.mod` が `go 1.26.1` を要求していたら golang:1.22-alpine では失敗**: Dockerfile を `golang:alpine` に変更してビルド側の Go を最新にしました。
- **`//go:embed all:embed` は空ディレクトリだとビルド失敗**: `.placeholder` を 1 つだけコミットして、ビルド時に Next.js の出力で上書きする運用に。
- **Cloudflare の SSL モード変更権限**: 当初 DNS:Edit だけの token で進めていたら `/settings/ssl` が 403。Origin CA cert 発行用に **`SSL and Certificates: Edit`** 権限を別途追加する必要がありました。
- **Origin CA Key は deprecated**: 旧来の Origin CA Key は廃止予定で、今は Account/User API Token に Certificates 権限を付けるのが正規ルートです。
- **`conoha app env set` が反映されない**: `docker-compose.yml` の `environment:` ブロックに同じキーが書いてあると、サーバー側 `.env.server` の値はそれに上書きされます。シークレットを `app env set` で渡したい場合は、compose 側からそのキーを外して `env_file: .env` を追加するか、`${VAR:-}` 形式の substitution を使う必要があります。
- **`go test ./...` がフレッシュチェックアウトで失敗**: 上記の embed 空ディレクトリ問題と同じ理由。`.placeholder` をコミットすることで CI でも `go test` が通るようになりました。

### まとめ

| 特徴 | 詳細 |
|---|---|
| **デプロイコマンド** | `conoha app deploy --no-proxy` の 1 行 |
| **TLS** | Cloudflare Origin CA 15 年 cert + Caddy（標準ビルド） |
| **コンテナ構成** | Caddy + 単一 Go バイナリ。コンテナ 2 つだけ |
| **メモリ** | g2l-t-c2m1 (1 GB) で十分余裕 |
| **冷起動** | バイナリ起動 ~200 ms、migration が初回のみ +50 ms |

個人ダッシュボードという小さな題材でしたが、`conoha-cli` の no-proxy モードと Cloudflare Origin CA の組み合わせは、ドメインが既に Cloudflare 配下にあるケースで最短経路だと感じます。SAML/SSO の前段に置く社内ツールや、複数の小さなサービスを同じパターンで量産するときにも転用しやすい構成です。

サンプルディレクトリには本記事の `Dockerfile` / `docker-compose.yml` / `Caddyfile` / cert 発行スクリプトをそのまま入れているので、自分のドメインで試したい方は次の 1 コマンドから始めてみてください。

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples
cd conoha-cli-app-samples/personal-dashboard
```

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
- [Cloudflare Origin CA - 公式ドキュメント](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/)
- [気象庁 防災情報 XML/JSON フィード](https://www.jma.go.jp/bosai/forecast/)
