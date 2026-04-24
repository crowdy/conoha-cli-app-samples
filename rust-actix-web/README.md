# rust-actix-web

Rust と Actix-web で構築した高速 REST API サーバーです。インメモリでメッセージの CRUD を行うシンプルなメッセージボードアプリケーションで、ConoHa VPS へのデプロイサンプルとして利用できます。

## 技術スタック

| 技術 | バージョン | 用途 |
|---|---|---|
| Rust | 1.94 (2024 edition) | 言語 |
| Actix-web | 4 | Web フレームワーク |
| Serde | 1 | JSON シリアライズ/デシリアライズ |
| Docker | マルチステージビルド | コンテナ化 |
| Alpine Linux | 3.21 | 軽量ランタイムイメージ |

## アーキテクチャ

```
┌─────────────────────────────────────────────┐
│  Docker Container (Alpine 3.21)             │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Actix-web Server (:3000)           │    │
│  │                                     │    │
│  │  GET  /           → HTML UI         │    │
│  │  GET  /health     → ヘルスチェック   │    │
│  │  GET  /api/messages  → 一覧取得     │    │
│  │  POST /api/messages  → 作成         │    │
│  │  DELETE /api/messages/:id → 削除    │    │
│  │                                     │    │
│  │  [インメモリ Vec<Message> ストア]     │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

**ローカルに Rust toolchain は不要です。** ビルドはすべてサーバー上の Docker マルチステージビルドで完結します。

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

初回ビルドは Rust コンパイルに数分かかります。Docker レイヤーキャッシュにより、2回目以降は依存関係の変更がなければ数秒で完了します。

## 動作確認

```bash
# ステータス確認
conoha app status myserver

# `rust-actix-web.example.com` は conoha.yml の `hosts:` に合わせて
# 自分の FQDN に置き換えてください。

# ヘルスチェック
curl https://rust-actix-web.example.com/health
# => {"status":"ok"}

# メッセージ作成
curl -X POST https://rust-actix-web.example.com/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"text": "Hello from conoha-cli!"}'
# => {"id":1,"text":"Hello from conoha-cli!"}

# メッセージ一覧
curl https://rust-actix-web.example.com/api/messages
# => [{"id":1,"text":"Hello from conoha-cli!"}]
```

ブラウザで `https://<あなたの FQDN>` にアクセスすると、メッセージの投稿・削除ができる Web UI が表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## API リファレンス

### `GET /`

メッセージボードの Web UI（HTML）を返します。

### `GET /health`

ヘルスチェック用エンドポイント。

**レスポンス:** `{"status": "ok"}`

### `GET /api/messages`

全メッセージの一覧を返します。

**レスポンス:**
```json
[
  {"id": 1, "text": "Hello"},
  {"id": 2, "text": "World"}
]
```

### `POST /api/messages`

新しいメッセージを作成します。

**リクエストボディ:**
```json
{"text": "your message here"}
```

**レスポンス:** `201 Created`
```json
{"id": 3, "text": "your message here"}
```

### `DELETE /api/messages/:id`

指定 ID のメッセージを削除します。

**レスポンス:** `204 No Content`（成功） / `404 Not Found`（存在しない ID）

## ディレクトリ構成

```
rust-actix-web/
├── Cargo.toml      # 依存関係定義
├── Dockerfile      # マルチステージビルド定義
├── compose.yml     # Docker Compose 設定
├── README.md
└── src/
    └── main.rs     # アプリケーション本体（ルーティング・ハンドラ・HTML UI）
```

## Docker マルチステージビルドの仕組み

```dockerfile
# Stage 1: ビルド（rust:1.94-alpine）
#   - 依存関係をキャッシュ（Cargo.toml だけ先にコピーしてビルド）
#   - ソースコードをコピーしてリリースビルド

# Stage 2: 実行（alpine:3.21）
#   - ビルド済みバイナリだけコピー
#   - 最終イメージサイズは数 MB と非常に軽量
```

Rust toolchain（約 1 GB）はビルドステージにのみ存在し、最終イメージには含まれません。

## カスタマイズ

- `src/main.rs` にルートを追加して機能を拡張
- データベースを追加する場合は [Diesel](https://diesel.rs/) や [SQLx](https://github.com/launchbadge/sqlx) を導入
- 静的ファイル配信は [actix-files](https://docs.rs/actix-files) を追加
- バイナリサイズが非常に小さくメモリ効率が高いため、小型 VPS でも快適に動作します
