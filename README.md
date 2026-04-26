# conoha-cli-app-samples

[conoha-cli](https://github.com/crowdy/conoha-cli) の `app deploy` コマンドで使えるサンプルアプリ集です。

各サンプルディレクトリにはすぐにデプロイできる `compose.yml`、`Dockerfile`、ソースコードが含まれています。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.3.0` がインストール済み
  （複数サブドメインを 1 アプリで束ねる `expose:` ブロックは v0.3.0 以降のサポート）
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み（`conoha keypair create` で作成可能）

## 使い方

サンプルディレクトリに `conoha.yml` があるものは blue/green プロキシ経由でデプロイします（新しい推奨フロー）。

```bash
# 1. このリポジトリをクローン
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/hello-world

# 2. サーバーを作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 3. conoha.yml の `hosts:` を自分の FQDN に書き換える
#    例: hello-world.example.com -> あなたのドメイン（DNS A レコードが VPS を指していること）

# 4. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 5. アプリ登録・デプロイ
conoha app init myserver
conoha app deploy myserver

# 6. ブラウザで https://<あなたの FQDN> にアクセス
```

サンプルはすべて `conoha.yml` を備えています（移行は完了済み — 経緯は crowdy/conoha-cli#97、サブドメイン分離は #54 を参照）。

## サンプル一覧

| サンプル | スタック | 説明 | 推奨フレーバー |
|---------|---------|------|--------------|
| [hello-world](hello-world/) | nginx + 静的HTML | 最もシンプルなサンプル | g2l-t-1 (1GB) |
| [nextjs](nextjs/) | Next.js (standalone) | Next.js デフォルトページ | g2l-t-2 (2GB) |
| [fastapi-ai-chatbot](fastapi-ai-chatbot/) | FastAPI + Ollama | AI チャットボット | g2l-t-4 (4GB) |
| [rails-postgresql](rails-postgresql/) | Rails + PostgreSQL | Rails scaffold アプリ | g2l-t-2 (2GB) |
| [wordpress-mysql](wordpress-mysql/) | WordPress + MySQL | WordPress ブログ | g2l-t-2 (2GB) |
| [spring-boot-postgresql](spring-boot-postgresql/) | Spring Boot + PostgreSQL | JPA CRUD アプリ | g2l-t-2 (2GB) |
| [express-mongodb](express-mongodb/) | Express.js + MongoDB | Mongoose CRUD アプリ | g2l-t-2 (2GB) |
| [hono-drizzle-postgresql](hono-drizzle-postgresql/) | Hono + Drizzle + PostgreSQL | ブックマーク管理 REST API + Swagger UI | g2l-t-2 (2GB) |
| [line-api-mock](line-api-mock/) | Hono + PostgreSQL + HTMX | LINE Messaging API モックサーバー(Webhook エミュレーション + 管理 UI) | g2l-t-2 (2GB) |
| [line-cli-go](line-cli-go/) | Go + line-bot-sdk-go v8 | LINE Messaging API CLI クライアント（line-api-mock 連動） | — |
| [bun-elysia-chat](bun-elysia-chat/) | Bun + Elysia + SQLite | リアルタイムチャット（WebSocket） | g2l-t-2 (2GB) |
| [laravel-mysql](laravel-mysql/) | Laravel + MySQL | Eloquent CRUD アプリ | g2l-t-2 (2GB) |
| [nextjs-fastapi-postgresql](nextjs-fastapi-postgresql/) | Next.js + FastAPI + PostgreSQL | フルスタック CRUD アプリ | g2l-t-2 (2GB) |
| [django-postgresql](django-postgresql/) | Django + PostgreSQL | Django ORM アプリ + 管理画面 | g2l-t-2 (2GB) |
| [vite-react](vite-react/) | Vite + React (静的SPA) | カウンターアプリ | g2l-t-1 (1GB) |
| [sveltekit](sveltekit/) | SvelteKit (SSR) | カウンターアプリ | g2l-t-2 (2GB) |
| [go-fiber](go-fiber/) | Go + Fiber | 高速 REST API | g2l-t-1 (1GB) |
| [nestjs-postgresql](nestjs-postgresql/) | NestJS + PostgreSQL | TypeORM CRUD アプリ | g2l-t-2 (2GB) |
| [rust-actix-web](rust-actix-web/) | Rust + Actix-web | 高速 REST API | g2l-t-2 (2GB) |
| [sendgrid-invitation](./sendgrid-invitation/) | Next.js + FastAPI + nginx Basic Auth | SendGrid 招待メール | g2l-t-2 (2GB) |
| [rails-mercari](rails-mercari/) | Rails + Nginx + Sidekiq + Redis + Dex + PostgreSQL | メルカリ風マーケットプレイス（OIDC認証付き） | g2l-t-2 (2GB) |
| [nextjs-go-google_ucp](nextjs-go-google_ucp/) | Next.js + Go + PostgreSQL | Google UCP デモ（AI エージェントコマース） | g2l-t-2 (2GB) |
| [nginx-reverse-proxy](nginx-reverse-proxy/) | nginx リバースプロキシ | マルチアプリ運用 | g2l-t-1 (1GB) |
| [ghost-blog](ghost-blog/) | Ghost + MySQL | ブログプラットフォーム | g2l-t-2 (2GB) |
| [gitea](gitea/) | Gitea + Dex + PostgreSQL | セルフホスティング Git（OIDC認証付き） | g2l-t-2 (2GB) |
| [minio-n8n](minio-n8n/) | MinIO + n8n | S3 ストレージ + ワークフロー自動化 | g2l-t-2 (2GB) |
| [ollama-webui](ollama-webui/) | Ollama + Open WebUI | ローカル LLM チャット（CPU） | g2l-t-4 (4GB) |
| [ollama-webui-gpu](ollama-webui-gpu/) | Ollama + Open WebUI (GPU) | Gemma 4 など大規模モデル対応 LLM チャット | g2l-t-c20m128g1-l4 (L4 GPU) |
| [fish-speech-tts-gpu](fish-speech-tts-gpu/) | Fish Speech + Go CLI | GPU 音声合成（TTS）+ 音声クローニング + CLI クライアント | g2l-t-c20m128g1-l4 (L4 GPU) |
| [hydra-python-api](hydra-python-api/) | Ory Hydra + FastAPI | OAuth2 認可サーバー + API | g2l-t-2 (2GB) |
| [quickwit-otel](quickwit-otel/) | Quickwit + OpenTelemetry + Grafana | ログ・トレース収集・検索基盤 | g2l-t-2 (2GB) |
| [uptime-kuma](uptime-kuma/) | Uptime Kuma | セルフホスティング稼働監視 | g2l-t-1 (1GB) |
| [prometheus-grafana](prometheus-grafana/) | Prometheus + Grafana + Node Exporter | メトリクス監視・可視化 | g2l-t-2 (2GB) |
| [github-actions-runner](github-actions-runner/) | GitHub Actions Runner | セルフホステッド CI/CD ランナー | g2l-t-2 (2GB) |
| [coolify](coolify/) | Coolify + PostgreSQL + Redis | セルフホスティング PaaS | g2l-t-4 (4GB) |
| [dokploy](dokploy/) | Dokploy + Traefik + PostgreSQL + Redis (Docker Swarm) | セルフホスティング PaaS（install.sh ベース） | g2l-t-4 (4GB) |
| [dify-https](dify-https/) | Dify + PostgreSQL + Redis + nginx | AI ワークフロープラットフォーム | g2l-t-4 (4GB) |
| [strapi-postgresql](strapi-postgresql/) | Strapi + PostgreSQL | ヘッドレス CMS | g2l-t-2 (2GB) |
| [supabase-selfhost](supabase-selfhost/) | Supabase (Studio + Kong + GoTrue + PostgREST + PostgreSQL) | セルフホスティング BaaS | g2l-t-4 (4GB) |
| [immich](immich/) | Immich + PostgreSQL + Redis | セルフホスティング写真管理 | g2l-t-4 (4GB) |
| [plausible-analytics](plausible-analytics/) | Plausible CE + PostgreSQL + ClickHouse | プライバシー重視 Web アナリティクス | g2l-t-2 (2GB) |
| [outline](outline/) | Outline + PostgreSQL + Redis + Dex | セルフホスティングチーム Wiki（OIDC認証付き） | g2l-t-2 (2GB) |
| [meilisearch](meilisearch/) | Meilisearch | セルフホスティング全文検索エンジン | g2l-t-1 (1GB) |

## 自分のアプリをデプロイするには

1. アプリディレクトリに `compose.yml`（または `docker-compose.yml`）と `conoha.yml` を用意します。公開したいサービスは `ports:` ではなく `expose:` でコンテナ側ポートだけを宣言してください（proxy が blue/green スロットごとに `127.0.0.1:0:PORT` を割り当てます）。

   ```yaml
   # conoha.yml の最小構成
   name: your-app
   hosts:
     - your-app.example.com
   web:
     service: web    # compose.yml のサービス名
     port: 3000      # 上記サービスの expose ポート
   ```

2. 以下を実行:

   ```bash
   cd your-app
   conoha proxy boot --acme-email you@example.com myserver   # 初回のみ
   conoha app init myserver
   conoha app deploy myserver
   ```

`Dockerfile` でビルドする場合は `compose.yml` の `build: .` を使ってください。DB や Redis などの付帯サービスは `conoha.yml` の `accessories:` に列挙すると blue/green 切替時も起動したままになります（`express-mongodb` 参照）。

### 複数サブドメインを 1 アプリで束ねる（`expose:` ブロック）

OIDC プロバイダーや管理 UI のように **root とは別のサブドメインで公開したいサービス** がある場合、`expose:` ブロックを追加します（conoha-cli `>= v0.3.0`）。

```yaml
name: your-app
# root web のホストだけをここに書く。`expose:` 側のサブドメインは
# proxy が自動で ACME するので `hosts:` への重複記載は不要
# （validation エラーになる）。DNS A レコードは両方必要。
hosts:
  - your-app.example.com
web:
  service: web
  port: 3000
expose:
  - label: admin
    host: admin.example.com
    service: admin-ui
    port: 8080
    blue_green: false    # セッションが分散しない単一インスタンス用途
accessories:
  - db
```

実例:

- 単一サブドメイン: [`gitea`](gitea/)（Dex を `dex.*` で公開）, [`outline`](outline/), [`hydra-python-api`](hydra-python-api/), [`supabase-selfhost`](supabase-selfhost/), [`quickwit-otel`](quickwit-otel/), [`nextjs-fastapi-clerk-stripe`](nextjs-fastapi-clerk-stripe/)
- 複数サブドメイン: [`rails-mercari`](rails-mercari/)（auth + app）, [`dify-https`](dify-https/)（api + web）

## 関連リンク

- [conoha-cli](https://github.com/crowdy/conoha-cli) — ConoHa VPS3 CLI ツール
- [ドキュメント](https://conoha-cli.jp) — チュートリアル・コマンドリファレンス
