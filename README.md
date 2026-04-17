# conoha-cli-app-samples

[conoha-cli](https://github.com/crowdy/conoha-cli) の `app deploy` コマンドで使えるサンプルアプリ集です。

各サンプルディレクトリにはすぐにデプロイできる `compose.yml`、`Dockerfile`、ソースコードが含まれています。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み（`conoha keypair create` で作成可能）

## 使い方

```bash
# 1. このリポジトリをクローン
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples

# 2. サーバーを作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 3. サンプルを選んでデプロイ
cd hello-world
conoha app init myserver --app-name hello-world
conoha app deploy myserver --app-name hello-world

# 4. 動作確認
conoha app logs myserver --app-name hello-world
```

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

`compose.yml`（または `docker-compose.yml`）があるディレクトリであれば、同じ手順でデプロイできます。

```bash
cd your-app
conoha app init myserver --app-name your-app
conoha app deploy myserver --app-name your-app
```

`Dockerfile` でビルドする場合は `compose.yml` の `build: .` を使ってください。

## 関連リンク

- [conoha-cli](https://github.com/crowdy/conoha-cli) — ConoHa VPS3 CLI ツール
- [ドキュメント](https://conoha-cli.jp) — チュートリアル・コマンドリファレンス
