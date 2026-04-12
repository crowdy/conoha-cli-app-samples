---
title: conoha-cliでRust（Actix-web）をConoHa VPSにワンコマンドデプロイ
tags: Conoha conoha-cli Rust actix-web Docker
author: crowdy
slide: false
---
## はじめに

Rust で Web アプリケーションを書いてみたけど、デプロイとなるとハードルが高い……と思ったことはありませんか？ ローカルに Rust toolchain を入れてクロスコンパイルして、バイナリを転送して、サービスを設定して……と手間が多い。

**結論から言えば、`conoha app deploy` ワンコマンドで完結します。** ローカルに Rust をインストールする必要すらありません。ビルドはサーバー上の Docker マルチステージビルドで完結するため、手元のターミナルだけで完結します。

本記事では、[conoha-cli](https://github.com/crowdy/conoha-cli) を使って Rust + Actix-web の REST API サーバーを ConoHa VPS にデプロイする手順を紹介します。

ソースコードは [conoha-cli-app-samples/rust-actix-web](https://github.com/crowdy/conoha-cli-app-samples/tree/main/rust-actix-web) にあります。

---

## Actix-web とは

**Actix-web** は Rust で最も人気の高い Web フレームワークの一つです。非同期ランタイム上で動作し、非常に高いスループットを誇ります。

| 特徴 | 説明 |
|---|---|
| **高速** | TechEmpower ベンチマークで常に上位 |
| **型安全** | Rust の型システムによるコンパイル時エラー検出 |
| **非同期** | Tokio ベースの async/await |
| **軽量バイナリ** | 静的リンクで数 MB のシングルバイナリ |

---

## 構成コンポーネント

| コンポーネント | 役割 |
|---|---|
| **Rust 1.94** (2024 edition) | 言語 |
| **Actix-web 4** | Web フレームワーク |
| **Serde** | JSON シリアライズ/デシリアライズ |
| **Docker マルチステージビルド** | ビルド環境とランタイムの分離 |
| **Alpine Linux 3.21** | 軽量ランタイムイメージ（最終イメージ数 MB） |

```
┌─────────────────────────────────────────────┐
│  Docker Container (Alpine 3.21)             │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Actix-web Server (:3000)           │    │
│  │                                     │    │
│  │  GET  /           → HTML UI         │    │
│  │  GET  /health     → ヘルスチェック    │    │
│  │  GET  /api/messages  → 一覧取得      │    │
│  │  POST /api/messages  → 作成          │    │
│  │  DELETE /api/messages/:id → 削除     │    │
│  │                                     │    │
│  │  [インメモリ Vec<Message> ストア]      │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

---

## conoha-cli とは

**conoha-cli** は ConoHa VPS3 をターミナルから操作する CLI ツールです。

- サーバーの作成・削除・一覧表示
- アプリの初期化・デプロイ・ステータス確認
- 環境変数の設定

SSH キーさえ設定すれば、コマンド 1 本でデプロイが完了します。

- GitHub: [crowdy/conoha-cli](https://github.com/crowdy/conoha-cli)

---

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

**ローカルに Rust toolchain は不要です。**

---

## ファイル構成

```
rust-actix-web/
├── Cargo.toml      # 依存関係定義
├── Dockerfile      # マルチステージビルド定義
├── compose.yml     # Docker Compose 設定
└── src/
    └── main.rs     # アプリケーション本体
```

たった 4 ファイルです。

---

## Dockerfile

```dockerfile
# Stage 1: Build
FROM rust:1.94-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Production runner
FROM alpine:3.21
WORKDIR /app
COPY --from=builder /app/target/release/conoha-rust-sample ./server
EXPOSE 3000
CMD ["./server"]
```

ポイント:

- **依存関係キャッシュ**: `Cargo.toml` だけ先にコピーしてダミーの `main.rs` でビルド → 依存クレートがキャッシュされ、2 回目以降のビルドが劇的に速くなる
- **マルチステージビルド**: Rust toolchain（約 1 GB）はビルドステージにのみ存在し、最終イメージには含まれない
- **Alpine ベース**: 最終イメージはバイナリだけをコピーした Alpine で、数 MB と非常に軽量

---

## compose.yml

```yaml
services:
  web:
    build: .
    ports:
      - "3000:3000"
```

シンプルです。`conoha app deploy` はこの `compose.yml` を使って `docker compose up` を実行します。

---

## ハマりポイント: Rust のビルド時間

初回デプロイ時、Rust の依存クレート（163 パッケージ）のコンパイルに **約 4 分** かかります。ターミナルにコンパイルログが大量に流れますが、フリーズではありません。正常です。

2 回目以降は Docker レイヤーキャッシュが効くため、ソースコードだけの変更なら **約 20 秒** で完了します。

---

## デプロイ手順

### 1. サンプルリポジトリをクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/rust-actix-web
```

### 2. アプリ初期化

サーバー上に Docker 環境と Git リポジトリをセットアップします。

```bash
$ conoha app init myserver --app-name rust-actix-web
```

```
Initializing app "rust-actix-web" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
==> Installing post-receive hook...
==> Done!
```

### 3. デプロイ

```bash
$ conoha app deploy myserver --app-name rust-actix-web
```

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
```

初回は約 4 分、2 回目以降（ソース変更のみ）は約 20 秒で完了します。

```
 Container rust-actix-web-web-1 Started
NAME                   IMAGE                COMMAND      SERVICE   STATUS   PORTS
rust-actix-web-web-1   rust-actix-web-web   "./server"   web       Up       0.0.0.0:3000->3000/tcp
Deploy complete.
```

### 4. ステータス確認

```bash
$ conoha app status myserver --app-name rust-actix-web
```

```
NAME                   IMAGE                COMMAND      SERVICE   STATUS          PORTS
rust-actix-web-web-1   rust-actix-web-web   "./server"   web       Up 18 seconds   0.0.0.0:3000->3000/tcp
```

---

## 動作確認

### ヘルスチェック

```bash
$ curl http://<サーバーIP>:3000/health
```

```json
{"status":"ok"}
```

### メッセージ作成

```bash
$ curl -X POST http://<サーバーIP>:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"text": "Hello from conoha-cli!"}'
```

```json
{"id":1,"text":"Hello from conoha-cli!"}
```

### メッセージ一覧

```bash
$ curl http://<サーバーIP>:3000/api/messages
```

```json
[{"id":1,"text":"Hello from conoha-cli!"}]
```

### Web UI

ブラウザで `http://<サーバーIP>:3000` にアクセスすると、メッセージの投稿・削除ができる Web UI が表示されます。

---

## API エンドポイント一覧

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/` | Web UI（HTML） |
| `GET` | `/health` | ヘルスチェック |
| `GET` | `/api/messages` | メッセージ一覧 |
| `POST` | `/api/messages` | メッセージ作成（`{"text": "..."}` を送信） |
| `DELETE` | `/api/messages/:id` | メッセージ削除 |

---

## つまずきポイントまとめ

| 問題 | 原因 | 解決策 |
|---|---|---|
| 初回ビルドに約 4 分かかる | Rust の依存クレート（163 パッケージ）のコンパイル | 正常動作。2 回目以降は Docker キャッシュで約 20 秒に短縮 |
| `edition = "2024"` でエラー | Rust 1.85 未満ではサポートされない | Dockerfile で `rust:1.85-alpine` 以上を使用（本サンプルは 1.94） |
| ポート 3000 にアクセスできない | VPS のファイアウォール設定 | ConoHa コントロールパネルでポート 3000 を開放 |

---

## まとめ

| 項目 | 内容 |
|---|---|
| 技術スタック | Rust 1.94 + Actix-web 4 |
| デプロイ方法 | `conoha app deploy` ワンコマンド |
| ローカル Rust 環境 | **不要**（Docker マルチステージビルドで完結） |
| 初回ビルド | 約 4 分 |
| 2 回目以降 | 約 20 秒（依存キャッシュ） |
| 最終イメージ | Alpine ベースで数 MB |
| アクセス URL | `http://<サーバーIP>:3000` |
| サンプルコード | [conoha-cli-app-samples/rust-actix-web](https://github.com/crowdy/conoha-cli-app-samples/tree/main/rust-actix-web) |

Rust のデプロイは「ローカルにツールチェーンを入れて、クロスコンパイルして……」という面倒なイメージがありますが、Docker マルチステージビルドと `conoha app deploy` を組み合わせれば、ローカルには Rust を一切インストールせずにデプロイできます。

[conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples) リポジトリには、他にも WordPress、Rails、Gitea、Ollama など 20 種類以上のサンプルが揃っていますので、ぜひ試してみてください。

---

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)

