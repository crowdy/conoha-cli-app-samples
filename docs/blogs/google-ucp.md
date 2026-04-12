---
title: conoha-cliでGoogle UCP（Universal Commerce Protocol）デモアプリをConoHa VPSにワンコマンドデプロイ
tags: Conoha conoha-cli Next.js Go GoogleUCP
author: crowdy
slide: false
---
## はじめに

2026年1月、Googleが発表した **Universal Commerce Protocol（UCP）** は、AIエージェントが商品検索・チェックアウト・決済を標準化されたプロトコルで実行するための仕様です。`/.well-known/ucp` にマニフェストを配置することで、AIエージェントがショップの機能を自動的に発見し、購入フローを実行できます。

しかし、UCP対応のデモアプリを実際に動かして試せる環境はまだ多くありません。

この記事では、UCP対応のフラワーショップデモアプリ（Next.js + Go + PostgreSQL）をConoHa VPS3上に `conoha app deploy` ワンコマンドでデプロイし、UCP の5ステップ購入フロー（Discovery → Negotiation → Checkout → Discount → Payment）を実際に動かして確認するまでの手順を紹介します。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## Google UCP（Universal Commerce Protocol）とは

[UCP](https://github.com/nickcmiller/universal-commerce-protocol) は、AIエージェントとコマース事業者の間のインタラクションを標準化するプロトコルです。

### 従来の課題

AIエージェントが「花を買いたい」というリクエストを受けた場合、従来はショップごとに異なるAPIを個別に統合する必要がありました。UCPは、この問題を以下の仕組みで解決します。

### UCP の仕組み

```
AIエージェント
  ↓ GET /.well-known/ucp
ショップのUCPマニフェスト（機能一覧を返す）
  ↓ Capability Negotiation（どの機能を使うか交渉）
チェックアウトセッション作成
  ↓ 割引適用・決済実行
注文完了
```

| 概念 | 説明 |
|------|------|
| **マニフェスト** | `/.well-known/ucp` に配置するJSON。ショップが対応するサービス・機能を宣言 |
| **Capability** | `dev.ucp.shopping.checkout`（チェックアウト）、`dev.ucp.shopping.discount`（割引）など |
| **Negotiation** | エージェントが必要な機能を要求し、ショップがサポートする機能との積集合を返す |
| **Payment Handler** | 決済手段の定義。Google Pay、Stripe等 |

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

## 使用するスタック

| コンポーネント | 技術 | 役割 |
|---|---|---|
| **frontend** | Next.js 15 + shadcn/ui + Tailwind CSS | 商品グリッド、カート、UCP Inspector |
| **api** | Go 1.23（標準ライブラリ `net/http`） | UCPマニフェスト、商品API、チェックアウトAPI |
| **db** | PostgreSQL 17 | 商品・チェックアウトセッション・注文アイテム |

### アーキテクチャ

```
ブラウザ → :80 → [frontend (Next.js 15)]
                      │
                      │ rewrites /api/* → api:8080/*
                      ▼
                  [api (Go 1.23)]
                      │
                      │ pgx
                      ▼
                  [db (PostgreSQL 17)]
```

```
AIエージェント → GET /.well-known/ucp → [frontend] → proxy → [api] /ucp/manifest
```

外部に公開するポートは **80番のみ**。Go APIへのアクセスはNext.jsのrewrites機能でプロキシされます。UCPマニフェストは `/.well-known/ucp` というNext.jsのRoute Handlerから、Go APIの `/ucp/manifest` へプロキシして返します。

---

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み（`conoha keypair create` で作成可能）

---

## ファイル構成

```
nextjs-go-google_ucp/
├── compose.yml
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.ts          # rewrites + standalone
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # 商品グリッド
│   │   ├── checkout/page.tsx   # カート・決済
│   │   ├── inspector/page.tsx  # UCP Inspector
│   │   └── .well-known/ucp/route.ts  # UCPマニフェストプロキシ
│   ├── components/
│   │   ├── product-card.tsx
│   │   ├── checkout-form.tsx
│   │   ├── manifest-viewer.tsx
│   │   └── checkout-simulator.tsx  # 5ステップシミュレーター
│   └── lib/
│       └── api.ts
├── api/
│   ├── Dockerfile
│   ├── go.mod
│   ├── main.go
│   ├── handler/
│   │   ├── products.go
│   │   ├── checkout.go
│   │   ├── manifest.go
│   │   └── health.go
│   ├── ucp/
│   │   ├── manifest.go         # UCPマニフェスト定義
│   │   └── negotiation.go      # Capability交渉ロジック
│   └── db/
│       └── migrations/001_init.sql  # スキーマ + シードデータ
└── docs/
```

---

## compose.yml

```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "80:3000"
    environment:
      - API_URL=http://api:8080
    depends_on:
      api:
        condition: service_healthy

  api:
    build: ./api
    expose:
      - "8080"
    environment:
      - DATABASE_URL=postgres://appuser:apppass@db:5432/appdb?sslmode=disable
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
      interval: 5s
      timeout: 5s
      retries: 5

  db:
    image: postgres:17
    environment:
      - POSTGRES_DB=appdb
      - POSTGRES_USER=appuser
      - POSTGRES_PASSWORD=apppass
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./api/db/migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

ポイント:

- **healthcheck チェーン**: db → api → frontend の順で起動。依存サービスがhealthyになるまで待機
- **ポート80のみ公開**: apiとdbは内部ネットワークのみ
- **初期化スクリプト**: `api/db/migrations/001_init.sql` をPostgreSQLの `docker-entrypoint-initdb.d` にマウントし、テーブル作成とシードデータ投入を自動実行

---

## ハマりポイント: GoのJSONフィールド名がPascalCaseになる問題

### 症状

デプロイ後、ブラウザでアクセスすると以下のエラーが表示されます。

```
Application error: a client-side exception has occurred
(see the browser console for more information)
```

### 原因

GoのAPIが返すJSONのフィールド名が **PascalCase**（`Name`, `PriceCents`, `ImageUrl`）で、フロントエンドが期待する **snake_case**（`name`, `price_cents`, `image_url`）と一致しない。

```json
// Go APIが返していたJSON
{
  "ID": "b37f729e-...",
  "Name": "Lavender Bundle",
  "PriceCents": 1899,
  "ImageUrl": "/images/lavender.jpg"
}
```

フロントエンドでは `product.name.includes("Sunflower")` で花の絵文字を出し分けていたため、`product.name` が `undefined` → `.includes()` で **TypeError** が発生し、画面全体がクラッシュしていました。

### 原因の詳細

このプロジェクトではGoのDB層に **sqlc** を使っています。sqlcが生成する構造体にはJSONタグが付きません。

```go
// sqlcが生成した構造体（JSONタグなし）
type Product struct {
    ID          pgtype.UUID
    Name        string
    PriceCents  int32
    // ...
}
```

Goの `encoding/json` はJSONタグがない場合、**フィールド名をそのまま** JSONキーとして出力します。Goのフィールド名はPascalCase（先頭大文字）が慣例なので、JSONもPascalCaseになります。

チェックアウト関連のハンドラーにはJSONタグ付きのDTO構造体が定義されていたため問題なかったのですが、商品ハンドラーだけsqlc生成の構造体を直接 `json.Encode` していたのが原因でした。

### 解決策

商品用のレスポンスDTO構造体を追加し、明示的にsnake_caseのJSONタグを付けます。

```go
type productResp struct {
    ID          uuid.UUID `json:"id"`
    Name        string    `json:"name"`
    Description string    `json:"description"`
    PriceCents  int32     `json:"price_cents"`
    Currency    string    `json:"currency"`
    ImageUrl    string    `json:"image_url"`
    InStock     bool      `json:"in_stock"`
}

func productToResp(p generated.Product) productResp {
    return productResp{
        ID:         uuidFromPgtype(p.ID),
        Name:       p.Name,
        PriceCents: p.PriceCents,
        // ...
    }
}
```

**教訓**: sqlc生成の構造体をAPIレスポンスに直接使わない。必ずJSONタグ付きのDTO構造体を経由する。

---

## デプロイ手順

### Step 1: サーバーの既存アプリを確認・削除

```bash
$ conoha app list tkim-cli-test
mercari                        running
rust-actix-web                 no containers
```

既存アプリを削除してリソースを確保します。

```bash
$ conoha app destroy tkim-cli-test --app-name mercari --yes
$ conoha app destroy tkim-cli-test --app-name rust-actix-web --yes
```

### Step 2: ワンコマンドデプロイ

```bash
$ cd nextjs-go-google_ucp
$ conoha app deploy tkim-cli-test --app-name ucp-demo
```

デプロイログの流れ:

1. カレントディレクトリをtar.gzに圧縮してサーバーへ転送
2. Go API: `golang:1.23-alpine` でビルド → `alpine:3.21` の軽量イメージへコピー
3. Next.js: `node:22-alpine` で `npm install` → `next build` → `standalone` 出力を軽量イメージへ
4. PostgreSQL 17: 初期化スクリプトでテーブル作成 + 5商品シードデータ投入
5. healthcheck チェーンで db → api → frontend の順に起動

全体で約2分で完了します。

### Step 3: 動作確認

```bash
$ curl http://<サーバーIP>/api/health
{"status":"ok"}

$ curl http://<サーバーIP>/api/products | jq '.[0]'
{
  "id": "b37f729e-...",
  "name": "Lavender Bundle",
  "price_cents": 1899,
  "currency": "USD",
  "image_url": "/images/lavender.jpg",
  "in_stock": true
}
```

---

## UCP動作確認: 5ステップでAIエージェントの購入フローを再現

UCPの核心は、AIエージェントが以下の5ステップで商品を購入できることです。実際にcurlで再現してみます。

### Step 1: Discovery（マニフェスト取得）

```bash
$ curl http://<サーバーIP>/.well-known/ucp | jq '.ucp.capabilities[].name'
"dev.ucp.shopping.checkout"
"dev.ucp.shopping.discount"
```

AIエージェントは `/.well-known/ucp` にアクセスするだけで、このショップが「チェックアウト」と「割引」に対応していることを発見できます。

### Step 2: Browse（商品一覧取得）

```bash
$ curl http://<サーバーIP>/api/products | jq '.[] | {name, price: (.price_cents/100)}'
{"name": "Lavender Bundle", "price": 18.99}
{"name": "Mixed Wildflowers", "price": 29.99}
{"name": "Red Rose Arrangement", "price": 39.99}
{"name": "Single White Lily", "price": 12.99}
{"name": "Sunflower Bouquet", "price": 24.99}
```

### Step 3: Create Checkout Session（注文作成 + Capability交渉）

```bash
$ curl -X POST http://<サーバーIP>/api/checkout-sessions \
  -H "Content-Type: application/json" \
  -d '{
    "buyer_email": "agent@example.com",
    "line_items": [{"product_id": "PRODUCT_UUID", "quantity": 2}],
    "requested_capabilities": [
      "dev.ucp.shopping.checkout",
      "dev.ucp.shopping.discount"
    ]
  }'
```

レスポンスには、交渉の結果サポートされたcapabilityのリストが含まれます:

```json
{
  "id": "SESSION_UUID",
  "status": "incomplete",
  "subtotal_cents": 3798,
  "total_cents": 3798,
  "capabilities": [
    {"name": "dev.ucp.shopping.checkout", "version": "2026-01-23"},
    {"name": "dev.ucp.shopping.discount", "version": "2026-01-23"}
  ]
}
```

### Step 4: Apply Discount（割引適用）

```bash
$ curl -X PUT http://<サーバーIP>/api/checkout-sessions/SESSION_UUID \
  -H "Content-Type: application/json" \
  -d '{"discount_code": "FLOWERS10"}'
```

```json
{
  "subtotal_cents": 3798,
  "discount_cents": 379,
  "total_cents": 3419
}
```

10%割引が適用され、合計が$37.98 → $34.19に。

### Step 5: Complete Payment（決済完了）

```bash
$ curl -X POST http://<サーバーIP>/api/checkout-sessions/SESSION_UUID/complete \
  -H "Content-Type: application/json" \
  -d '{"payment": {"handler_id": "mock_google_pay", "token": "tok_mock_success"}}'
```

```json
{
  "status": "complete",
  "payment_handler": "mock_google_pay",
  "total_cents": 3419
}
```

### ブラウザでの確認: UCP Inspector

`http://<サーバーIP>/inspector` にアクセスすると、上記の5ステップをブラウザ上でインタラクティブに実行できます。各ステップのHTTPリクエストとレスポンスJSONがリアルタイムで表示されるため、UCPの仕組みを視覚的に理解できます。

---

## まとめ

- **Google UCP** は、AIエージェントが標準化されたプロトコルでコマース操作を行うための仕組み。`/.well-known/ucp` マニフェストによるDiscovery、Capability Negotiation、チェックアウト・決済までの一連のフローが定義されている
- **Next.js + Go + PostgreSQL** の3層構成でUCP対応デモアプリを実装。Go APIは標準ライブラリの `net/http` のみ、DB層はsqlcでタイプセーフなクエリを生成
- **conoha-cli** のワンコマンドデプロイで、ローカル環境にGoやNode.jsをインストールすることなくVPS上にデプロイ完了
- **ハマりポイント**: sqlc生成の構造体を直接JSONレスポンスに使うと、GoのPascalCaseフィールド名がそのままJSONキーになり、フロントエンドのsnake_case期待と不一致になる。DTO構造体を挟んで明示的にJSONタグを付けるのが鉄則

ソースコードは [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples) の `nextjs-go-google_ucp` ディレクトリに収録されています。

