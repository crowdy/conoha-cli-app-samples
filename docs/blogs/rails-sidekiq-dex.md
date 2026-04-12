---
title: conoha-cliでRails + Sidekiq + Dex OIDCのマーケットプレイスをConoHa VPSにワンコマンドデプロイ
tags: Rails Docker sidekiq Conoha OIDC
author: crowdy
slide: false
---
## はじめに

**Rails + PostgreSQL + Redis + Sidekiq + Nginx + Dex OIDC** — 本番環境に近い6サービス構成のWebアプリケーションを、ローカルにRubyもNode.jsもインストールせずにConoHa VPSへワンコマンドでデプロイできたら便利だと思いませんか？

本記事では、**Mercari風の中古マーケットプレイスアプリ**を題材に、`conoha-cli`を使ってConoHa VPS上にデプロイする手順を紹介します。

Ruby on Railsは、日本でも**freee（会計ソフト）**、**Cookpad（レシピ共有）**、**Mercari（中古取引）**、**Wantedly（ビジネスSNS）**、**SmartNews（ニュースアプリ）**、**note（コンテンツ共有）**、**Qiita（本サイト）** をはじめ、多くの有名サービスで採用されています。

今回のサンプルアプリは以下の機能を備えています:

- **商品の出品・購入**: 商品CRUD + 購入アクション
- **OIDC認証**: Dex（OIDC Identity Provider）によるシングルサインオン
- **非同期通知**: Sidekiq + Redisによる購入通知ジョブ
- **リバースプロキシ**: Nginxがポート80で全サービスへのアクセスを集約

---

## conoha-cliとは

[conoha-cli](https://github.com/crowdy/conoha-cli)は、ConoHa VPS3をターミナルから操作できるCLIツールです。

- **サーバー作成・削除**をコマンドで実行
- **Docker Composeアプリ**をワンコマンドでデプロイ（`conoha app deploy`）
- ローカルのソースコードをtar.gz化してSSH経由で転送、サーバー上でビルド・起動
- **ローカルにRuby/Node.js等のインストールは不要** — すべてDockerコンテナ内で完結

---

## 前提条件

- `conoha-cli`がインストール済みであること
- ConoHa VPS3アカウント
- SSHキーペアが登録済みであること

---

## 今回デプロイするアプリの構成

### 使用するスタック

| コンポーネント | バージョン | 役割 |
|:---:|:---:|:---|
| Ruby | 3.4 | アプリケーション言語 |
| Rails | 8.1 | Webフレームワーク |
| PostgreSQL | 17 | メインDB + Dex DB |
| Redis | 7 | Sidekiqジョブキュー |
| Sidekiq | 7.3 | 非同期ジョブワーカー |
| Nginx | latest | リバースプロキシ |
| Dex | v2.45.1 | OIDC認証プロバイダ |
| Puma | 7.2 | Railsアプリケーションサーバー |

### アーキテクチャ

```
                       ┌─────────┐
                       │ Browser │
                       └────┬────┘
                            │ :80
                       ┌────▼────┐
                       │  Nginx  │
                       └────┬────┘
                  ┌─────────┼──────────┐
                  │ /       │          │ /dex
            ┌─────▼─────┐  │   ┌──────▼──────┐
            │ Rails/Puma │  │   │  Dex :5556  │
            │   :3000    │  │   │ (OIDC IdP)  │
            └──┬───┬─────┘  │   └──────┬──────┘
               │   │        │          │
        ┌──────▼┐ ┌▼──────┐ │  ┌───────▼───────┐
        │ Redis │ │Sidekiq│ │  │  PostgreSQL   │
        │ :6379 │ │(worker)│ │  │    :5432      │
        └───────┘ └───────┘ │  │ app_prod + dex│
                            │  └───────────────┘
```

**ポイント**: Nginxがポート80のみを外部公開し、`/` へのアクセスをRails（Puma）へ、`/dex/` へのアクセスをDex（OIDCプロバイダ）へプロキシします。

---

## ファイル構成

```
rails-mercari/
├── compose.yml            # 6サービスのDocker Compose定義
├── Dockerfile             # マルチステージビルド（web + sidekiq共有）
├── .dockerignore
├── nginx.conf             # リバースプロキシ設定
├── dex.yml                # OIDC設定（sedプレースホルダ）
├── init-db.sh             # Dex用DB作成スクリプト
├── Gemfile                # Rails 8.1 + Sidekiq + OmniAuth
├── Gemfile.lock
├── Rakefile
├── config.ru
├── bin/
│   ├── docker-entrypoint  # db:prepare → exec
│   └── rails
├── config/
│   ├── application.rb
│   ├── boot.rb
│   ├── database.yml
│   ├── environment.rb
│   ├── environments/production.rb
│   ├── routes.rb
│   └── initializers/
│       ├── omniauth.rb    # Dex OIDC接続設定
│       └── sidekiq.rb     # Redis接続設定
├── app/
│   ├── controllers/
│   │   ├── application_controller.rb
│   │   ├── items_controller.rb
│   │   ├── purchases_controller.rb
│   │   └── sessions_controller.rb
│   ├── models/
│   │   ├── user.rb        # Dex OIDC連携
│   │   ├── item.rb        # 商品（on_sale / sold）
│   │   └── purchase.rb    # 購入 → 非同期通知
│   ├── jobs/
│   │   └── purchase_notification_job.rb
│   └── views/
│       ├── layouts/application.html.erb
│       ├── items/
│       └── shared/
└── db/
    └── migrate/
        ├── 20260101000000_create_users.rb
        ├── 20260101000001_create_items.rb
        └── 20260101000002_create_purchases.rb
```

---

## compose.yml

6つのサービスを定義しています。

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - web
      - dex

  web:
    build: .
    environment:
      - RAILS_ENV=production
      - DB_HOST=db
      - DB_USER=postgres
      - DB_PASSWORD=postgres
      - DB_NAME=app_production
      - SECRET_KEY_BASE=placeholder_change_me_in_production
      - REDIS_URL=redis://redis:6379/0
      - OIDC_ISSUER=http://dex:5556/dex
      - OIDC_EXTERNAL_HOST=${RAILS_HOST:-localhost}
      - OIDC_CLIENT_ID=mercari-app
      - OIDC_CLIENT_SECRET=mercari-dex-secret
      - OIDC_REDIRECT_URI=http://${RAILS_HOST:-localhost}/auth/dex/callback
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      dex:
        condition: service_healthy

  sidekiq:
    build: .
    command: bundle exec sidekiq
    environment:
      - RAILS_ENV=production
      - DB_HOST=db
      - DB_USER=postgres
      - DB_PASSWORD=postgres
      - DB_NAME=app_production
      - SECRET_KEY_BASE=placeholder_change_me_in_production
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  dex:
    image: dexidp/dex:v2.45.1
    entrypoint: ["sh", "-c"]
    command:
      - |
        sed \
          -e "s|__DEX_ISSUER_HOST__|$$DEX_ISSUER_HOST|g" \
          -e "s|__DEX_DB_PASSWORD__|$$DEX_DB_PASSWORD|g" \
          -e "s|__RAILS_OIDC_CLIENT_ID__|$$RAILS_OIDC_CLIENT_ID|g" \
          -e "s|__RAILS_OIDC_CLIENT_SECRET__|$$RAILS_OIDC_CLIENT_SECRET|g" \
          -e "s|__RAILS_HOST__|$$RAILS_HOST|g" \
          /etc/dex/dex.yml > /tmp/dex.yml &&
        exec dex serve /tmp/dex.yml
    environment:
      - DEX_ISSUER_HOST=${DEX_ISSUER_HOST:-localhost}
      - DEX_DB_PASSWORD=dex
      - RAILS_OIDC_CLIENT_ID=mercari-app
      - RAILS_OIDC_CLIENT_SECRET=mercari-dex-secret
      - RAILS_HOST=${RAILS_HOST:-localhost}
    volumes:
      - ./dex.yml:/etc/dex/dex.yml:ro
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:5558/healthz"]
      interval: 5s
      timeout: 5s
      retries: 5

  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=app_production
      - DEX_DB_NAME=dex
      - DEX_DB_USER=dex
      - DEX_DB_PASSWORD=dex
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./init-db.sh:/docker-entrypoint-initdb.d/init-db.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
  redis_data:
```

**ポイント**:
- **web**と**sidekiq**は同じDockerfileからビルド。`command`のオーバーライドでSidekiqワーカーとして動作
- **dex**は`sed`でプレースホルダを環境変数に置換してから起動（[前回のGitea + Dex記事](https://qiita.com/crowdy/items/bfef8ca1d1e773cd47be)と同じパターン）
- **db**は`init-db.sh`でDex用の別データベース・ユーザーを自動作成
- すべてのステートフルサービスに**ヘルスチェック**を設定し、依存関係を`service_healthy`で制御

---

## Dockerfile

マルチステージビルドでイメージサイズを最小化しています。

```dockerfile
FROM ruby:3.4-slim AS builder
WORKDIR /app
RUN apt-get update -qq && apt-get install -y build-essential libpq-dev libyaml-dev
COPY Gemfile Gemfile.lock ./
RUN bundle install --jobs 4

FROM ruby:3.4-slim
WORKDIR /app
RUN apt-get update -qq && apt-get install -y libpq5 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/bundle /usr/local/bundle
COPY . .
RUN chmod +x bin/docker-entrypoint bin/rails
ENV RAILS_ENV=production
EXPOSE 3000
ENTRYPOINT ["bin/docker-entrypoint"]
CMD ["bundle", "exec", "puma", "-b", "tcp://0.0.0.0:3000"]
```

- **builderステージ**: `build-essential`、`libpq-dev`、`libyaml-dev`をインストールしてgemをビルド
- **runtimeステージ**: `libpq5`のみ。ビルドツールは含めない
- `ENTRYPOINT`で`bin/docker-entrypoint`を実行し、DBマイグレーション後にPumaを起動

---

## nginx.conf

```nginx
upstream rails {
    server web:3000;
}

upstream dex_upstream {
    server dex:5556;
}

server {
    listen 80;

    location /dex/ {
        proxy_pass http://dex_upstream/dex/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://rails;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

ポート80だけを外部に公開し、URLパスで振り分けます:
- `/dex/*` → Dex（OIDC認証画面、トークンエンドポイント等）
- `/` → Rails（アプリケーション本体）

---

## Dex OIDC設定

### dex.yml

```yaml
issuer: http://__DEX_ISSUER_HOST__/dex

storage:
  type: postgres
  config:
    host: db
    port: 5432
    database: dex
    user: dex
    password: __DEX_DB_PASSWORD__
    ssl:
      mode: disable

web:
  http: 0.0.0.0:5556

telemetry:
  http: 0.0.0.0:5558

oauth2:
  skipApprovalScreen: true

staticClients:
  - id: __RAILS_OIDC_CLIENT_ID__
    redirectURIs:
      - "http://__RAILS_HOST__/auth/dex/callback"
    name: "Mercari App"
    secret: __RAILS_OIDC_CLIENT_SECRET__

enablePasswordDB: true

staticPasswords:
  - email: "seller@example.com"
    hash: "$2b$10$XGMG1ahO/4deJwCMTEr0EuMyX1zZolLqDz4.Jvg6aunUIq.gJF6Re"
    username: "seller"
    userID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  - email: "buyer@example.com"
    hash: "$2b$10$XGMG1ahO/4deJwCMTEr0EuMyX1zZolLqDz4.Jvg6aunUIq.gJF6Re"
    username: "buyer"
    userID: "b2c3d4e5-f6a7-8901-bcde-f12345678901"
```

- `__PLACEHOLDER__`は`compose.yml`の`sed`コマンドで環境変数に置換されます
- テスト用に2名のユーザー（seller / buyer、パスワードはどちらも`password`）を`staticPasswords`で定義

### init-db.sh

PostgreSQL初回起動時にDex用データベースを自動作成します。

```bash
#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE ${DEX_DB_NAME:-dex};
    CREATE USER ${DEX_DB_USER:-dex} WITH PASSWORD '${DEX_DB_PASSWORD:-dex}';
    GRANT ALL PRIVILEGES ON DATABASE ${DEX_DB_NAME:-dex} TO ${DEX_DB_USER:-dex};
    ALTER DATABASE ${DEX_DB_NAME:-dex} OWNER TO ${DEX_DB_USER:-dex};
EOSQL
```

---

## 非同期通知の仕組み（Sidekiq + Redis）

購入が完了すると、`Purchase`モデルの`after_create`コールバックで**PurchaseNotificationJob**がRedisキューに投入されます。

### app/models/purchase.rb

```ruby
class Purchase < ApplicationRecord
  belongs_to :item
  belongs_to :buyer, class_name: "User"

  after_create :enqueue_notification

  private

  def enqueue_notification
    PurchaseNotificationJob.perform_later(id)
  end
end
```

### app/jobs/purchase_notification_job.rb

```ruby
class PurchaseNotificationJob < ApplicationJob
  queue_as :default

  def perform(purchase_id)
    purchase = Purchase.includes(:item, :buyer, item: :seller).find(purchase_id)
    item = purchase.item
    seller = item.seller
    buyer = purchase.buyer

    Rails.logger.info(
      "[NOTIFICATION] Item '#{item.title}' (#{item.price} yen) " \
      "purchased by #{buyer.name} (#{buyer.email}). " \
      "Notifying seller #{seller.name} (#{seller.email})."
    )
  end
end
```

デモのため`Rails.logger.info`でログ出力していますが、実際のサービスではここでメール送信やプッシュ通知を行います。

---

## デプロイ手順

### 1. リポジトリをクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/rails-mercari
```

### 2. サーバーを作成

```bash
conoha server create --name mercari-server \
  --flavor g2l-t-2 \
  --image ubuntu-24.04 \
  --key-name mykey \
  --security-group IPv4v6-Web \
  --wait
```

### 3. アプリを初期化

```bash
conoha app init mercari-server --app-name mercari
```

Docker / Docker Compose / Gitがサーバーにインストールされます。

### 4. 環境変数を設定

サーバーのIPアドレスを確認します。

```bash
conoha server show mercari-server
```

`.env.server`を作成してDexのissuerホストを設定します。

```bash
cat > .env.server << 'EOF'
DEX_ISSUER_HOST=<サーバーIP>
RAILS_HOST=<サーバーIP>
OIDC_REDIRECT_URI=http://<サーバーIP>/auth/dex/callback
EOF
```

### 5. デプロイ

```bash
conoha app deploy mercari-server --app-name mercari
```

初回はDockerイメージのビルドがあるため数分かかります。完了すると6つのコンテナが起動します。

```
NAME                IMAGE                COMMAND         SERVICE   STATUS
mercari-db-1        postgres:17-alpine   ...             db        Up (healthy)
mercari-dex-1       dexidp/dex:v2.45.1   ...             dex       Up (healthy)
mercari-nginx-1     nginx:alpine         ...             nginx     Up
mercari-redis-1     redis:7-alpine       ...             redis     Up (healthy)
mercari-sidekiq-1   mercari-sidekiq      ...             sidekiq   Up
mercari-web-1       mercari-web          ...             web       Up
```

---

## 動作確認

### 商品一覧ページ

ブラウザで`http://<サーバーIP>/`にアクセスすると、商品一覧ページが表示されます。

### OIDC認証フロー

1. **「Dexでログイン」ボタン**をクリック
2. DexのログインフォームにリダイレクトされるSaleので、テストユーザーでログイン

| メールアドレス | パスワード | 役割 |
|:---:|:---:|:---:|
| seller@example.com | password | 出品者 |
| buyer@example.com | password | 購入者 |

3. 認証成功後、アプリにリダイレクトされログイン状態になります

### 商品の出品・購入

1. **seller@example.com**でログインし、「出品する」から商品を登録
2. ログアウト → **buyer@example.com**でログイン
3. 商品の「購入する」ボタンをクリック → **SOLD**表示に変わる

### 非同期通知の確認

購入後、Sidekiqが非同期で通知ジョブを実行します。ログで確認できます。

```bash
conoha app logs mercari-server --app-name mercari
```

```
sidekiq-1  | INFO: Performing PurchaseNotificationJob with arguments: 1
sidekiq-1  | INFO: [NOTIFICATION] Item 'テスト商品' (1000 yen)
           |   purchased by buyer (buyer@example.com).
           |   Notifying seller seller (seller@example.com).
sidekiq-1  | INFO: Performed PurchaseNotificationJob in 216.06ms
```

### Dex OIDC Discovery

```bash
curl http://<サーバーIP>/dex/.well-known/openid-configuration | jq .issuer
```

```json
"http://<サーバーIP>/dex"
```

---

## ハマりポイント

今回のデプロイではいくつかのハマりポイントがありました。

| 問題 | 原因 | 解決策 |
|:---|:---|:---|
| `psych` gemのビルド失敗 | Ruby 3.4 + libyaml-devが未インストール | Dockerfileのbuilderステージに`libyaml-dev`を追加 |
| `rails new`のヘルプが表示される | `bin/rails`のコンテンツが不正 + 実行権限なし | 標準的な`bin/rails`に修正 + `chmod +x` |
| OmniAuth/Sidekiq `NameError` | `Bundler.require(*Rails.groups)`が呼ばれていない | `config/application.rb`に追加 |
| OIDC Discovery SSL エラー | `openid_connect` gemがHTTPSを強制 | Discovery無効化 + エンドポイント手動設定 |
| Dex issuerが`localhost`になる | `.env.server`が`.env`にコピーされていない | `.env.server`にサーバーIPを設定 + 再デプロイ |
| 購入ボタンで404 | ルートパラメータ名の不一致（`params[:item_id]` vs `params[:id]`） | member routeでは`params[:id]`を使用 |

特に**OIDC Discovery + HTTP環境**の組み合わせは要注意です。`openid_connect` gemはセキュリティ上HTTPSを前提としているため、Docker内部のHTTP通信ではDiscoveryを無効化してエンドポイントを手動設定する必要がありました。

---

## まとめ

| 項目 | 内容 |
|:---|:---|
| アプリ | Mercari風マーケットプレイス |
| フレームワーク | Ruby 3.4 + Rails 8.1 |
| サービス数 | 6（Nginx, Rails/Puma, Sidekiq, Redis, PostgreSQL, Dex） |
| 認証 | Dex OIDC（staticPasswords） |
| 非同期処理 | Sidekiq + Redis |
| デプロイコマンド | `conoha app init` → `conoha app deploy` |
| ローカル環境 | Ruby / Node.js のインストール不要 |

サンプルのソースコードは以下のリポジトリにあります:

https://github.com/crowdy/conoha-cli-app-samples/tree/main/rails-mercari

### 参考

- [conoha-cli GitHub リポジトリ](https://github.com/crowdy/conoha-cli)
- [conoha-cli サンプルアプリ集](https://github.com/crowdy/conoha-cli-app-samples)
- [前回記事: Gitea + Dex OIDC + PostgreSQLをワンコマンドデプロイ](https://qiita.com/crowdy/items/bfef8ca1d1e773cd47be)
- [Dex OIDC公式ドキュメント](https://dexidp.io/docs/)
- [Sidekiq公式](https://sidekiq.org/)

