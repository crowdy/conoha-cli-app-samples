# New Sample Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 11 new self-hosted app samples following existing repository conventions — each with `compose.yml`, `README.md`, and optional config files.

**Architecture:** Each sample is an independent directory containing a Docker Compose stack deployable via `conoha app deploy`. All samples use official Docker images (no custom Dockerfiles), named volumes for persistence, `${VAR:-default}` env templating, and Japanese README documentation.

**Tech Stack:** Docker Compose, official images from Docker Hub / GitHub Container Registry

---

## File Structure Overview

Each of the 11 samples creates a new directory:

```
sample-name/
├── compose.yml       (required)
├── README.md         (required, Japanese)
└── [config files]    (optional, service-specific)
```

After all samples, `README.md` (root) is updated with the new entries in the table.

---

### Task 1: uptime-kuma

**Files:**
- Create: `uptime-kuma/compose.yml`
- Create: `uptime-kuma/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    ports:
      - "3001:3001"
    volumes:
      - uptime_kuma_data:/app/data
    restart: unless-stopped

volumes:
  uptime_kuma_data:
```

- [ ] **Step 2: Create README.md**

```markdown
# uptime-kuma

軽量なセルフホスティング監視ツール。Web サイトやサービスの稼働状態をリアルタイムで確認できます。

## 構成

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — 稼働監視ダッシュボード
- ポート: 3001（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# アプリ初期化・デプロイ
conoha app init myserver --app-name uptime-kuma
conoha app deploy myserver --app-name uptime-kuma
\```

## 動作確認

ブラウザで `http://<サーバーIP>:3001` にアクセスし、初期管理者アカウントを作成します。

## カスタマイズ

- ダッシュボードから監視対象（HTTP、TCP、DNS、Ping など）を追加
- 通知チャネル（Slack、Discord、LINE、メールなど）を設定可能
- 本番環境では nginx リバースプロキシを前段に追加し HTTPS 化を推奨
```

- [ ] **Step 3: Commit**

```bash
git add uptime-kuma/
git commit -m "feat: add uptime-kuma sample (self-hosted monitoring)"
```

---

### Task 2: prometheus-grafana

**Files:**
- Create: `prometheus-grafana/compose.yml`
- Create: `prometheus-grafana/prometheus.yml`
- Create: `prometheus-grafana/README.md`

- [ ] **Step 1: Create prometheus.yml**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]

  - job_name: "node-exporter"
    static_configs:
      - targets: ["node-exporter:9100"]
```

- [ ] **Step 2: Create compose.yml**

```yaml
services:
  prometheus:
    image: prom/prometheus:v3.3.0
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=15d"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:9090/-/healthy"]
      interval: 10s
      timeout: 5s
      retries: 5

  grafana:
    image: grafana/grafana:11.6.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=${GF_ADMIN_USER:-admin}
      - GF_SECURITY_ADMIN_PASSWORD=${GF_ADMIN_PASSWORD:-admin}
    volumes:
      - grafana_data:/var/lib/grafana
    depends_on:
      prometheus:
        condition: service_healthy

  node-exporter:
    image: prom/node-exporter:v1.9.0
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - "--path.procfs=/host/proc"
      - "--path.sysfs=/host/sys"
      - "--path.rootfs=/rootfs"
      - "--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)"

volumes:
  prometheus_data:
  grafana_data:
```

- [ ] **Step 3: Create README.md**

```markdown
# prometheus-grafana

メトリクス収集・可視化の業界標準スタック。サーバーの CPU、メモリ、ディスクなどをリアルタイムで監視できます。

## 構成

- [Prometheus](https://prometheus.io/) v3.3 — メトリクス収集・保存
- [Grafana](https://grafana.com/) v11.6 — ダッシュボード・可視化
- [Node Exporter](https://github.com/prometheus/node_exporter) v1.9 — ホストメトリクス
- ポート: 9090（Prometheus）、3000（Grafana）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name prometheus-grafana

# （任意）Grafana 管理者パスワードを変更
conoha app env set myserver --app-name prometheus-grafana \
  GF_ADMIN_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name prometheus-grafana
\```

## 動作確認

1. Prometheus: `http://<サーバーIP>:9090` → Status > Targets で node-exporter が UP
2. Grafana: `http://<サーバーIP>:3000` → admin / admin でログイン
3. Grafana で Data Source に `http://prometheus:9090` を追加
4. Dashboard ID `1860`（Node Exporter Full）をインポート

## カスタマイズ

- `prometheus.yml` にスクレイプ対象を追加して他のサービスも監視可能
- Grafana のアラート機能で Slack・メール通知を設定
- 保持期間は `--storage.tsdb.retention.time` で調整（デフォルト 15 日）
- 本番環境では `GF_ADMIN_PASSWORD` を必ず変更してください
```

- [ ] **Step 4: Commit**

```bash
git add prometheus-grafana/
git commit -m "feat: add prometheus-grafana sample (metrics monitoring)"
```

---

### Task 3: github-actions-runner

**Files:**
- Create: `github-actions-runner/compose.yml`
- Create: `github-actions-runner/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  runner:
    image: myoung34/github-runner:latest
    environment:
      - REPO_URL=${REPO_URL}
      - ACCESS_TOKEN=${ACCESS_TOKEN}
      - RUNNER_NAME=${RUNNER_NAME:-conoha-runner}
      - RUNNER_WORKDIR=/tmp/runner/work
      - LABELS=${RUNNER_LABELS:-self-hosted,linux,x64}
      - DISABLE_AUTO_UPDATE=1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - runner_work:/tmp/runner/work
    restart: unless-stopped

volumes:
  runner_work:
```

- [ ] **Step 2: Create README.md**

```markdown
# github-actions-runner

GitHub Actions のセルフホステッドランナーを ConoHa VPS 上で実行します。プライベートリポジトリの CI/CD を自前サーバーで処理できます。

## 構成

- [GitHub Actions Runner](https://github.com/myoung34/docker-github-actions-runner) — セルフホステッドランナー（Docker-in-Docker 対応）
- Docker ソケットマウントで Docker ビルドも可能

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- GitHub Personal Access Token（`repo` スコープ）

## デプロイ

\```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name github-actions-runner

# 環境変数を設定（必須）
conoha app env set myserver --app-name github-actions-runner \
  REPO_URL=https://github.com/your-org/your-repo \
  ACCESS_TOKEN=ghp_xxxxxxxxxxxx

# デプロイ
conoha app deploy myserver --app-name github-actions-runner
\```

## 動作確認

1. GitHub リポジトリの Settings > Actions > Runners でランナーが **Idle** 状態を確認
2. ワークフローに `runs-on: self-hosted` を指定してジョブを実行

## カスタマイズ

- `RUNNER_LABELS` でカスタムラベルを追加（例: `gpu,large`）
- 組織レベルのランナーにする場合は `REPO_URL` を `https://github.com/your-org` に変更
- 複数ランナーを起動するには `docker compose up -d --scale runner=3`
- 本番環境では `ACCESS_TOKEN` に Fine-grained Token を推奨
```

- [ ] **Step 3: Commit**

```bash
git add github-actions-runner/
git commit -m "feat: add github-actions-runner sample (self-hosted CI/CD)"
```

---

### Task 4: coolify

**Files:**
- Create: `coolify/compose.yml`
- Create: `coolify/README.md`

- [ ] **Step 1: Create compose.yml**

Coolify は公式インストールスクリプトで導入する設計のため、compose.yml は最小限のブートストラップにする。

```yaml
services:
  coolify:
    image: ghcr.io/coollabsio/coolify:4
    ports:
      - "8000:8000"
      - "6001:6001"
      - "6002:6002"
    environment:
      - APP_ID=${APP_ID:-coolify}
      - APP_KEY=${APP_KEY:-base64:generated-key-placeholder}
      - APP_URL=${APP_URL:-http://localhost:8000}
      - DB_PASSWORD=${DB_PASSWORD:-coolify}
      - REDIS_PASSWORD=${REDIS_PASSWORD:-coolify}
    volumes:
      - /data/coolify:/data/coolify
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=coolify
      - POSTGRES_PASSWORD=${DB_PASSWORD:-coolify}
      - POSTGRES_DB=coolify
    volumes:
      - coolify_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U coolify"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD:-coolify}
    volumes:
      - coolify_redis:/data

volumes:
  coolify_db:
  coolify_redis:
```

- [ ] **Step 2: Create README.md**

```markdown
# coolify

セルフホスティングの PaaS（Platform as a Service）。ConoHa VPS 上に Vercel / Netlify のような自動デプロイ環境を構築できます。

## 構成

- [Coolify](https://coolify.io/) v4 — PaaS プラットフォーム
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・キュー
- ポート: 8000（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

> **推奨**: Coolify は公式インストールスクリプトの利用が最も簡単です。
> `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
>
> 以下は compose.yml を使ったデプロイ方法です。

\```bash
# サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name coolify

# 環境変数を設定
conoha app env set myserver --app-name coolify \
  DB_PASSWORD=your-secure-password \
  REDIS_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name coolify
\```

## 動作確認

ブラウザで `http://<サーバーIP>:8000` にアクセスし、初期管理者アカウントを作成します。

## カスタマイズ

- Coolify UI からアプリケーション・データベース・サービスをワンクリックでデプロイ可能
- GitHub / GitLab 連携で Push 時の自動デプロイを設定
- Let's Encrypt による自動 HTTPS 証明書取得をサポート
- 本番環境では `DB_PASSWORD`、`REDIS_PASSWORD` を必ず変更してください
```

- [ ] **Step 3: Commit**

```bash
git add coolify/
git commit -m "feat: add coolify sample (self-hosted PaaS)"
```

---

### Task 5: dify-https

**Files:**
- Create: `dify-https/compose.yml`
- Create: `dify-https/nginx.conf`
- Create: `dify-https/README.md`

- [ ] **Step 1: Create nginx.conf**

```nginx
server {
    listen 80;
    server_name _;

    client_max_body_size 15M;

    location /api {
        proxy_pass http://api:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /console/api {
        proxy_pass http://api:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1 {
        proxy_pass http://api:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /files {
        proxy_pass http://api:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 2: Create compose.yml**

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api
      - web
    restart: unless-stopped

  api:
    image: langgenius/dify-api:0.15
    environment:
      - MODE=api
      - SECRET_KEY=${SECRET_KEY:-sk-dify-secret-key-change-me}
      - DB_USERNAME=dify
      - DB_PASSWORD=${DB_PASSWORD:-difyai}
      - DB_HOST=db
      - DB_PORT=5432
      - DB_DATABASE=dify
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=${REDIS_PASSWORD:-difyai}
      - STORAGE_TYPE=local
      - STORAGE_LOCAL_PATH=/app/api/storage
    volumes:
      - dify_storage:/app/api/storage
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  worker:
    image: langgenius/dify-api:0.15
    environment:
      - MODE=worker
      - SECRET_KEY=${SECRET_KEY:-sk-dify-secret-key-change-me}
      - DB_USERNAME=dify
      - DB_PASSWORD=${DB_PASSWORD:-difyai}
      - DB_HOST=db
      - DB_PORT=5432
      - DB_DATABASE=dify
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=${REDIS_PASSWORD:-difyai}
      - STORAGE_TYPE=local
      - STORAGE_LOCAL_PATH=/app/api/storage
    volumes:
      - dify_storage:/app/api/storage
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  web:
    image: langgenius/dify-web:0.15
    environment:
      - CONSOLE_API_URL=
      - APP_API_URL=

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=dify
      - POSTGRES_PASSWORD=${DB_PASSWORD:-difyai}
      - POSTGRES_DB=dify
    volumes:
      - dify_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dify"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD:-difyai}
    volumes:
      - dify_redis:/data

volumes:
  dify_storage:
  dify_db:
  dify_redis:
```

- [ ] **Step 3: Create README.md**

```markdown
# dify-https

AI ワークフロー・エージェント構築プラットフォーム。RAG、チャットボット、ワークフロー自動化を GUI で構築できます。

## 構成

- [Dify](https://dify.ai/) v0.15 — AI プラットフォーム（API + Worker + Web）
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・キュー
- nginx — リバースプロキシ
- ポート: 80（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name dify-https

# 環境変数を設定
conoha app env set myserver --app-name dify-https \
  SECRET_KEY=your-random-secret-key \
  DB_PASSWORD=your-secure-password \
  REDIS_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name dify-https
\```

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスし、初期管理者アカウントを作成します。

## カスタマイズ

- OpenAI、Anthropic、Ollama などの LLM プロバイダーを設定 > モデルプロバイダーから追加
- ナレッジベース機能で RAG を構築（PDF、Markdown などをアップロード）
- HTTPS 化する場合は nginx.conf を編集し Let's Encrypt 証明書を設定
- 本番環境では `SECRET_KEY`、`DB_PASSWORD`、`REDIS_PASSWORD` を必ず変更してください
```

- [ ] **Step 4: Commit**

```bash
git add dify-https/
git commit -m "feat: add dify-https sample (AI workflow platform with nginx proxy)"
```

---

### Task 6: strapi-postgresql

**Files:**
- Create: `strapi-postgresql/compose.yml`
- Create: `strapi-postgresql/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  strapi:
    image: strapi/strapi:5-alpine
    ports:
      - "1337:1337"
    environment:
      - DATABASE_CLIENT=postgres
      - DATABASE_HOST=db
      - DATABASE_PORT=5432
      - DATABASE_NAME=strapi
      - DATABASE_USERNAME=strapi
      - DATABASE_PASSWORD=${DB_PASSWORD:-strapi}
      - APP_KEYS=${APP_KEYS:-key1,key2,key3,key4}
      - API_TOKEN_SALT=${API_TOKEN_SALT:-change-me}
      - ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET:-change-me}
      - TRANSFER_TOKEN_SALT=${TRANSFER_TOKEN_SALT:-change-me}
      - JWT_SECRET=${JWT_SECRET:-change-me}
    volumes:
      - strapi_uploads:/opt/app/public/uploads
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=strapi
      - POSTGRES_PASSWORD=${DB_PASSWORD:-strapi}
      - POSTGRES_DB=strapi
    volumes:
      - strapi_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U strapi"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  strapi_uploads:
  strapi_db:
```

- [ ] **Step 2: Create README.md**

```markdown
# strapi-postgresql

API ファーストのヘッドレス CMS。コンテンツ API を GUI で定義し、Next.js や SvelteKit などのフロントエンドから利用できます。

## 構成

- [Strapi](https://strapi.io/) v5 — ヘッドレス CMS
- PostgreSQL 16 — データベース
- ポート: 1337（管理画面 + API）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name strapi-postgresql

# 環境変数を設定
conoha app env set myserver --app-name strapi-postgresql \
  DB_PASSWORD=your-secure-password \
  APP_KEYS=key1,key2,key3,key4 \
  API_TOKEN_SALT=$(openssl rand -base64 16) \
  ADMIN_JWT_SECRET=$(openssl rand -base64 16) \
  JWT_SECRET=$(openssl rand -base64 16)

# デプロイ
conoha app deploy myserver --app-name strapi-postgresql
\```

## 動作確認

1. `http://<サーバーIP>:1337/admin` で初期管理者アカウントを作成
2. Content-Type Builder でコンテンツタイプを定義
3. `http://<サーバーIP>:1337/api/<content-type>` で REST API にアクセス

## カスタマイズ

- GraphQL プラグインを有効にすると GraphQL API も利用可能
- メディアライブラリで画像・ファイルを管理
- Next.js や SvelteKit のフロントエンドと組み合わせてフルスタック構成に
- 本番環境では全てのシークレットキーを必ず変更してください
```

- [ ] **Step 3: Commit**

```bash
git add strapi-postgresql/
git commit -m "feat: add strapi-postgresql sample (headless CMS)"
```

---

### Task 7: supabase-selfhost

**Files:**
- Create: `supabase-selfhost/compose.yml`
- Create: `supabase-selfhost/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  studio:
    image: supabase/studio:20250317-6be1014
    ports:
      - "3000:3000"
    environment:
      - STUDIO_PG_META_URL=http://meta:8080
      - SUPABASE_URL=http://kong:8000
      - SUPABASE_ANON_KEY=${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}
      - SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}
    depends_on:
      - meta

  kong:
    image: kong:3.9
    ports:
      - "8000:8000"
    environment:
      - KONG_DATABASE=off
      - KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml
      - KONG_DNS_ORDER=LAST,A,CNAME
      - KONG_PLUGINS=request-transformer,cors,key-auth,acl,basic-auth
      - KONG_NGINX_PROXY_PROXY_BUFFER_SIZE=160k
      - KONG_NGINX_PROXY_PROXY_BUFFERS=64 160k
      - SUPABASE_ANON_KEY=${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0}
      - SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}
    volumes:
      - ./kong.yml:/home/kong/kong.yml:ro

  auth:
    image: supabase/gotrue:v2.170.0
    environment:
      - GOTRUE_API_HOST=0.0.0.0
      - GOTRUE_API_PORT=9999
      - API_EXTERNAL_URL=${API_EXTERNAL_URL:-http://localhost:8000}
      - GOTRUE_DB_DRIVER=postgres
      - GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${POSTGRES_PASSWORD:-postgres}@db:5432/postgres
      - GOTRUE_SITE_URL=${SITE_URL:-http://localhost:3000}
      - GOTRUE_JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters}
      - GOTRUE_JWT_EXP=3600
      - GOTRUE_DISABLE_SIGNUP=false
    depends_on:
      db:
        condition: service_healthy

  rest:
    image: postgrest/postgrest:v12.2.12
    environment:
      - PGRST_DB_URI=postgres://authenticator:${POSTGRES_PASSWORD:-postgres}@db:5432/postgres
      - PGRST_DB_SCHEMAS=public,storage,graphql_public
      - PGRST_DB_ANON_ROLE=anon
      - PGRST_JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters}
    depends_on:
      db:
        condition: service_healthy

  meta:
    image: supabase/postgres-meta:v0.88.2
    environment:
      - PG_META_PORT=8080
      - PG_META_DB_HOST=db
      - PG_META_DB_PORT=5432
      - PG_META_DB_NAME=postgres
      - PG_META_DB_USER=supabase_admin
      - PG_META_DB_PASSWORD=${POSTGRES_PASSWORD:-postgres}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: supabase/postgres:15.8.1.060
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
      - JWT_SECRET=${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters}
    volumes:
      - supabase_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U supabase_admin"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  supabase_db:
```

- [ ] **Step 2: Create kong.yml (API Gateway config)**

```yaml
_format_version: "2.1"

services:
  - name: auth-v1
    url: http://auth:9999/
    routes:
      - name: auth-v1-route
        strip_path: true
        paths:
          - /auth/v1/
    plugins:
      - name: cors

  - name: rest-v1
    url: http://rest:3000/
    routes:
      - name: rest-v1-route
        strip_path: true
        paths:
          - /rest/v1/
    plugins:
      - name: cors
      - name: key-auth
        config:
          hide_credentials: false
          key_names:
            - apikey

  - name: meta
    url: http://meta:8080/
    routes:
      - name: meta-route
        strip_path: true
        paths:
          - /pg/

consumers:
  - username: anon
    keyauth_credentials:
      - key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
  - username: service_role
    keyauth_credentials:
      - key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

- [ ] **Step 3: Create README.md**

```markdown
# supabase-selfhost

Firebase 代替のオープンソース BaaS（Backend as a Service）。認証、データベース、REST API、管理 UI をセルフホストで利用できます。

## 構成

- [Supabase](https://supabase.com/) — BaaS プラットフォーム
  - Studio — 管理 UI
  - Kong — API ゲートウェイ
  - GoTrue — 認証サービス
  - PostgREST — REST API 自動生成
  - PostgreSQL 15 — データベース
- ポート: 3000（Studio UI）、8000（API Gateway）、5432（PostgreSQL）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成（4GB 以上推奨）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name supabase-selfhost

# 環境変数を設定
conoha app env set myserver --app-name supabase-selfhost \
  POSTGRES_PASSWORD=your-secure-password \
  JWT_SECRET=$(openssl rand -base64 32)

# デプロイ
conoha app deploy myserver --app-name supabase-selfhost
\```

## 動作確認

1. Studio UI: `http://<サーバーIP>:3000` で管理画面にアクセス
2. REST API: `http://<サーバーIP>:8000/rest/v1/` にリクエスト（apikey ヘッダーが必要）
3. Studio から Table Editor でテーブルを作成し、API で CRUD 操作

## カスタマイズ

- Next.js や SvelteKit から `@supabase/supabase-js` で接続可能
- Studio の SQL Editor でマイグレーションやファンクション作成
- 本番環境では JWT シークレットと API キーを必ず再生成してください
- ANON_KEY / SERVICE_ROLE_KEY は JWT_SECRET を元に https://supabase.com/docs/guides/self-hosting#api-keys で生成
```

- [ ] **Step 4: Commit**

```bash
git add supabase-selfhost/
git commit -m "feat: add supabase-selfhost sample (self-hosted BaaS)"
```

---

### Task 8: immich

**Files:**
- Create: `immich/compose.yml`
- Create: `immich/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:v1.131.3
    ports:
      - "2283:2283"
    environment:
      - DB_HOSTNAME=db
      - DB_USERNAME=immich
      - DB_PASSWORD=${DB_PASSWORD:-immich}
      - DB_DATABASE_NAME=immich
      - REDIS_HOSTNAME=redis
    volumes:
      - immich_uploads:/usr/src/app/upload
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped

  immich-machine-learning:
    image: ghcr.io/immich-app/immich-machine-learning:v1.131.3
    volumes:
      - immich_ml_cache:/cache
    restart: unless-stopped

  db:
    image: tensorchord/pgvecto-rs:pg16-v0.4.0
    environment:
      - POSTGRES_USER=immich
      - POSTGRES_PASSWORD=${DB_PASSWORD:-immich}
      - POSTGRES_DB=immich
      - POSTGRES_INITDB_ARGS=--data-checksums
    volumes:
      - immich_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U immich"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - immich_redis:/data

volumes:
  immich_uploads:
  immich_ml_cache:
  immich_db:
  immich_redis:
```

- [ ] **Step 2: Create README.md**

```markdown
# immich

Google フォト代替のセルフホスティング写真・動画管理プラットフォーム。AI による自動分類・検索機能を備えています。

## 構成

- [Immich](https://immich.app/) v1.131 — 写真・動画管理（サーバー + ML）
- PostgreSQL 16（pgvecto.rs 拡張）— データベース + ベクトル検索
- Redis 7 — キャッシュ
- ポート: 2283（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成（4GB 以上推奨、写真の量に応じてストレージも検討）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name immich

# 環境変数を設定
conoha app env set myserver --app-name immich \
  DB_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name immich
\```

## 動作確認

1. ブラウザで `http://<サーバーIP>:2283` にアクセス
2. 初期管理者アカウントを作成
3. モバイルアプリ（iOS / Android）からサーバー URL を設定してバックアップ開始

## カスタマイズ

- モバイルアプリで自動バックアップを設定（Wi-Fi のみ、外部ストレージなど）
- 顔認識・場所検索・スマートアルバム機能が利用可能
- 外部ストレージ（NFS、S3 互換）をマウントして写真保存先を変更可能
- 本番環境では `DB_PASSWORD` を必ず変更してください
```

- [ ] **Step 3: Commit**

```bash
git add immich/
git commit -m "feat: add immich sample (self-hosted photo management)"
```

---

### Task 9: plausible-analytics

**Files:**
- Create: `plausible-analytics/compose.yml`
- Create: `plausible-analytics/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  plausible:
    image: ghcr.io/plausible/community-edition:v2.1.6
    ports:
      - "8000:8000"
    environment:
      - BASE_URL=${BASE_URL:-http://localhost:8000}
      - SECRET_KEY_BASE=${SECRET_KEY_BASE:-please-change-me-to-a-random-64-char-string-use-openssl-rand-base64-48}
      - DATABASE_URL=postgres://plausible:${DB_PASSWORD:-plausible}@db:5432/plausible
      - CLICKHOUSE_DATABASE_URL=http://clickhouse:8123/plausible
    depends_on:
      db:
        condition: service_healthy
      clickhouse:
        condition: service_started
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=plausible
      - POSTGRES_PASSWORD=${DB_PASSWORD:-plausible}
      - POSTGRES_DB=plausible
    volumes:
      - plausible_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U plausible"]
      interval: 5s
      timeout: 5s
      retries: 5

  clickhouse:
    image: clickhouse/clickhouse-server:24.3-alpine
    volumes:
      - plausible_events:/var/lib/clickhouse
    ulimits:
      nofile:
        soft: 262144
        hard: 262144

volumes:
  plausible_db:
  plausible_events:
```

- [ ] **Step 2: Create README.md**

```markdown
# plausible-analytics

プライバシー重視の軽量 Web アナリティクス。Google Analytics の代替として、Cookie 不要でシンプルな解析ができます。

## 構成

- [Plausible CE](https://plausible.io/) v2.1 — Web アナリティクス
- PostgreSQL 16 — ユーザー・サイト情報
- ClickHouse 24.3 — イベントデータ（高速集計）
- ポート: 8000（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name plausible-analytics

# 環境変数を設定
conoha app env set myserver --app-name plausible-analytics \
  BASE_URL=http://your-server-ip:8000 \
  SECRET_KEY_BASE=$(openssl rand -base64 48) \
  DB_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name plausible-analytics
\```

## 動作確認

1. `http://<サーバーIP>:8000` で管理者アカウントを作成
2. サイトを追加してトラッキングスクリプトを取得
3. 対象サイトの `<head>` にスクリプトタグを追加

\```html
<script defer data-domain="yourdomain.com" src="http://<サーバーIP>:8000/js/script.js"></script>
\```

## カスタマイズ

- Cookie 不要のため GDPR / ePrivacy 準拠（バナー不要）
- カスタムイベント、ゴール設定、UTM パラメータ解析が可能
- メール配信を設定するには SMTP 環境変数を追加
- Next.js / SvelteKit などのフロントエンドサンプルと組み合わせて利用可能
- 本番環境では `SECRET_KEY_BASE`、`DB_PASSWORD` を必ず変更してください
```

- [ ] **Step 3: Commit**

```bash
git add plausible-analytics/
git commit -m "feat: add plausible-analytics sample (privacy-friendly web analytics)"
```

---

### Task 10: outline

**Files:**
- Create: `outline/compose.yml`
- Create: `outline/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  outline:
    image: outlinewiki/outline:0.82.0
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://outline:${DB_PASSWORD:-outline}@db:5432/outline
      - REDIS_URL=redis://redis:6379
      - SECRET_KEY=${SECRET_KEY:-please-change-me-use-openssl-rand-hex-32}
      - UTILS_SECRET=${UTILS_SECRET:-please-change-me-use-openssl-rand-hex-32}
      - URL=${URL:-http://localhost:3000}
      - FILE_STORAGE=local
      - FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data
      - FORCE_HTTPS=false
    volumes:
      - outline_data:/var/lib/outline/data
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=outline
      - POSTGRES_PASSWORD=${DB_PASSWORD:-outline}
      - POSTGRES_DB=outline
    volumes:
      - outline_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U outline"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - outline_redis:/data

volumes:
  outline_data:
  outline_db:
  outline_redis:
```

- [ ] **Step 2: Create README.md**

```markdown
# outline

Notion 代替のセルフホスティングチーム Wiki・ナレッジベース。Markdown エディタと豊富なコラボレーション機能を備えています。

## 構成

- [Outline](https://www.getoutline.com/) v0.82 — Wiki / ナレッジベース
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・リアルタイム同期
- ポート: 3000（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- SSO プロバイダー（Outline はログインに SSO が必須: Slack、Google、OIDC など）

## デプロイ

\```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name outline

# 環境変数を設定（SSO 設定は必須）
conoha app env set myserver --app-name outline \
  SECRET_KEY=$(openssl rand -hex 32) \
  UTILS_SECRET=$(openssl rand -hex 32) \
  DB_PASSWORD=your-secure-password \
  URL=http://your-server-ip:3000 \
  SLACK_CLIENT_ID=your-slack-client-id \
  SLACK_CLIENT_SECRET=your-slack-client-secret

# デプロイ
conoha app deploy myserver --app-name outline
\```

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスし、SSO でログインします。

## カスタマイズ

- SSO プロバイダー: Slack、Google、Azure AD、OIDC を環境変数で設定
- Slack 連携で `/outline search <query>` コマンドが利用可能
- API で外部ツールとの連携やコンテンツ同期が可能
- S3 互換ストレージへのファイル保存も設定可能
- 本番環境では `SECRET_KEY`、`UTILS_SECRET`、`DB_PASSWORD` を必ず変更してください
```

- [ ] **Step 3: Commit**

```bash
git add outline/
git commit -m "feat: add outline sample (self-hosted team wiki)"
```

---

### Task 11: meilisearch

**Files:**
- Create: `meilisearch/compose.yml`
- Create: `meilisearch/README.md`

- [ ] **Step 1: Create compose.yml**

```yaml
services:
  meilisearch:
    image: getmeili/meilisearch:v1.13
    ports:
      - "7700:7700"
    environment:
      - MEILI_MASTER_KEY=${MEILI_MASTER_KEY:-change-me-to-a-secure-master-key}
      - MEILI_ENV=production
    volumes:
      - meilisearch_data:/meili_data
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:7700/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  meilisearch_data:
```

- [ ] **Step 2: Create README.md**

```markdown
# meilisearch

Algolia 代替の高速セルフホスティング全文検索エンジン。タイポ耐性、ファセット検索、日本語対応を備えた RESTful API を提供します。

## 構成

- [Meilisearch](https://www.meilisearch.com/) v1.13 — 全文検索エンジン
- ポート: 7700（REST API + ミニダッシュボード）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

\```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name meilisearch

# 環境変数を設定
conoha app env set myserver --app-name meilisearch \
  MEILI_MASTER_KEY=$(openssl rand -base64 32)

# デプロイ
conoha app deploy myserver --app-name meilisearch
\```

## 動作確認

\```bash
# ドキュメントを追加
curl -X POST "http://<サーバーIP>:7700/indexes/movies/documents" \
  -H "Authorization: Bearer <MEILI_MASTER_KEY>" \
  -H "Content-Type: application/json" \
  --data-binary '[
    {"id": 1, "title": "千と千尋の神隠し", "genre": "アニメ"},
    {"id": 2, "title": "もののけ姫", "genre": "アニメ"},
    {"id": 3, "title": "天気の子", "genre": "アニメ"}
  ]'

# 検索（タイポ耐性あり）
curl "http://<サーバーIP>:7700/indexes/movies/search?q=千と千尋" \
  -H "Authorization: Bearer <MEILI_MASTER_KEY>"
\```

ブラウザで `http://<サーバーIP>:7700` にアクセスするとミニダッシュボードも利用可能です。

## カスタマイズ

- 日本語トークナイザーが組み込み済み（設定不要）
- フロントエンド向け SDK: JavaScript、React、Vue、Svelte など
- Strapi や WordPress と連携してコンテンツ検索に利用可能
- 本番環境では `MEILI_MASTER_KEY` を必ず安全な値に変更してください
```

- [ ] **Step 3: Commit**

```bash
git add meilisearch/
git commit -m "feat: add meilisearch sample (self-hosted search engine)"
```

---

### Task 12: Update root README.md

**Files:**
- Modify: `README.md` (root)

- [ ] **Step 1: Add 11 new entries to the sample table**

Add the following rows to the `## サンプル一覧` table in root `README.md`, after the existing `quickwit-otel` row:

```markdown
| [uptime-kuma](uptime-kuma/) | Uptime Kuma | セルフホスティング稼働監視 | g2l-t-1 (1GB) |
| [prometheus-grafana](prometheus-grafana/) | Prometheus + Grafana + Node Exporter | メトリクス監視・可視化 | g2l-t-2 (2GB) |
| [github-actions-runner](github-actions-runner/) | GitHub Actions Runner | セルフホステッド CI/CD ランナー | g2l-t-2 (2GB) |
| [coolify](coolify/) | Coolify + PostgreSQL + Redis | セルフホスティング PaaS | g2l-t-4 (4GB) |
| [dify-https](dify-https/) | Dify + PostgreSQL + Redis + nginx | AI ワークフロープラットフォーム | g2l-t-4 (4GB) |
| [strapi-postgresql](strapi-postgresql/) | Strapi + PostgreSQL | ヘッドレス CMS | g2l-t-2 (2GB) |
| [supabase-selfhost](supabase-selfhost/) | Supabase (Studio + Kong + GoTrue + PostgREST + PostgreSQL) | セルフホスティング BaaS | g2l-t-4 (4GB) |
| [immich](immich/) | Immich + PostgreSQL + Redis | セルフホスティング写真管理 | g2l-t-4 (4GB) |
| [plausible-analytics](plausible-analytics/) | Plausible CE + PostgreSQL + ClickHouse | プライバシー重視 Web アナリティクス | g2l-t-2 (2GB) |
| [outline](outline/) | Outline + PostgreSQL + Redis | セルフホスティングチーム Wiki | g2l-t-2 (2GB) |
| [meilisearch](meilisearch/) | Meilisearch | セルフホスティング全文検索エンジン | g2l-t-1 (1GB) |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add 11 new samples to README table"
```

---

## Self-Review Checklist

- [x] **Spec coverage**: All 11 requested samples covered (dify-https, coolify, github-actions-runner, prometheus-grafana, uptime-kuma, supabase-selfhost, strapi-postgresql, immich, plausible-analytics, outline, meilisearch) + root README update
- [x] **Placeholder scan**: No TBD/TODO. All compose.yml have concrete image tags, ports, volumes, env vars
- [x] **Type consistency**: All samples follow identical conventions — `${VAR:-default}` env templating, named volumes with `_data`/`_db`/`_redis` suffixes, Japanese README format, `healthcheck` on DB services, `depends_on` with `condition: service_healthy`
- [x] **Pattern adherence**: Matches existing samples — no custom networks, no resource limits, Alpine images where available, `restart: unless-stopped` for standalone services
- [x] **Scope**: Each task is independent and can be committed separately

Plan complete and saved to `docs/superpowers/plans/2026-04-06-new-samples.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?