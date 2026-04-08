# rails-mercari Design Spec

## Overview

Mercari-style used goods marketplace example for conoha-cli-app-samples. Extends the existing `rails-postgresql` pattern with Redis, Nginx, Sidekiq, and Dex OIDC authentication.

**Goal**: Demonstrate a production-like 6-service Docker Compose stack deployable via `conoha app deploy`.

## Architecture

```
                         ┌─────────┐
                         │  User   │
                         └────┬────┘
                              │ :80
                         ┌────▼────┐
                         │  Nginx  │
                         └────┬────┘
                    ┌─────────┼──────────┐
                    │ /       │          │ /dex
              ┌─────▼─────┐  │   ┌──────▼──────┐
              │ Rails/Puma │  │   │   Dex:5556  │
              │   :3000    │  │   │  (OIDC IdP) │
              └──┬───┬─────┘  │   └──────┬──────┘
                 │   │        │          │
          ┌──────▼┐ ┌▼──────┐ │  ┌───────▼───────┐
          │ Redis │ │Sidekiq│ │  │  PostgreSQL   │
          │ :6379 │ │(worker)│ │  │  :5432        │
          └───────┘ └───────┘ │  │ ┌───────────┐ │
                              │  │ │app_prod DB│ │
                              │  │ │dex DB     │ │
                              │  │ └───────────┘ │
                              │  └───────────────┘
```

### Services (6)

| Service | Image | Role | Port |
|---------|-------|------|------|
| nginx | nginx:alpine | Reverse proxy (Rails + Dex) | 80 (external) |
| web | Dockerfile (ruby:3.4-slim) | Rails app (Puma) | 3000 (internal) |
| sidekiq | Same Dockerfile | Async job worker | - |
| redis | redis:7-alpine | Sidekiq queue + cache | 6379 (internal) |
| db | postgres:17-alpine | Main DB + Dex DB | 5432 (internal) |
| dex | dexidp/dex | OIDC identity provider | 5556 (internal) |

### Dependency Chain

```
db (healthcheck: pg_isready)
  ├── dex (depends_on: db healthy)
  ├── redis (independent, healthcheck: redis-cli ping)
  │
  └── web (depends_on: db healthy, redis healthy, dex healthy)
       ├── sidekiq (depends_on: db healthy, redis healthy)
       └── nginx (depends_on: web, dex)
```

## Data Model

### User
- `id`, `email`, `name`, `dex_sub` (OIDC subject identifier)
- `has_many :items` (as seller), `has_many :purchases` (as buyer)
- Created on first OIDC login via find_or_create_by(dex_sub)

### Item
- `id`, `title`, `description`, `price` (integer, yen)
- `status`: enum — `on_sale`, `sold`
- `belongs_to :seller` (User)
- `has_one :purchase`

### Purchase
- `id`, `item_id`, `buyer_id` (User), `purchased_at`
- `belongs_to :item`, `belongs_to :buyer` (User)
- `after_create` triggers `PurchaseNotificationJob.perform_async`

## Core Flows

### Authentication (Dex OIDC)
1. User clicks "Dexでログイン"
2. Rails redirects to `/auth/dex` (OmniAuth)
3. Nginx proxies to Dex at `/dex/`
4. Dex shows login form (staticPasswords: seller@example.com, buyer@example.com)
5. On success, Dex redirects to `/auth/dex/callback`
6. Rails extracts email + sub from ID token, find_or_create User, stores `session[:user_id]`

### Item Listing
- `GET /` — item index, visible to all (logged in or not)
- `GET /items/new` — new item form (login required)
- `POST /items` — create item (login required)

### Purchase
- `POST /items/:id/buy` — create purchase (login required, cannot buy own item)
- Sets `item.status = :sold`
- Enqueues `PurchaseNotificationJob` to Sidekiq via Redis

### Async Notification (Sidekiq)
- `PurchaseNotificationJob` picks up from Redis queue
- Logs notification: "Item X purchased by buyer Y, notifying seller Z"
- Demo purpose — no real email. `Rails.logger.info` output visible in `conoha app logs`.

## Routes

```ruby
root "items#index"
resources :items, only: [:index, :new, :create] do
  post :buy, on: :member
end
get "/auth/dex/callback", to: "sessions#create"
get "/logout", to: "sessions#destroy"
```

## Gems

```ruby
gem "rails", "~> 8.1"
gem "pg", "~> 1.6"
gem "puma", "~> 7.2"
gem "sidekiq", "~> 7.3"
gem "omniauth", "~> 2.1"
gem "omniauth_openid_connect", "~> 0.8"
gem "omniauth-rails_csrf_protection", "~> 1.0"
```

## Dex Configuration

### dex.yml (sed-based templating, same pattern as gitea example)

```yaml
issuer: http://__DEX_ISSUER_HOST__/dex
storage:
  type: postgres
  config:
    host: db
    database: dex
    user: dex
    password: __DEX_DB_PASSWORD__
oauth2:
  skipApprovalScreen: true
staticClients:
  - id: __RAILS_OIDC_CLIENT_ID__
    name: Mercari App
    secret: __RAILS_OIDC_CLIENT_SECRET__
    redirectURIs:
      - http://__RAILS_HOST__/auth/dex/callback
staticPasswords:
  - email: "seller@example.com"
    hash: <bcrypt of "password">
    username: "seller"
  - email: "buyer@example.com"
    hash: <bcrypt of "password">
    username: "buyer"
```

### init-db.sh

Creates `dex` database and `dex` user on first PostgreSQL startup.

## Nginx Configuration

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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

## Docker Configuration

### Dockerfile (multi-stage, shared by web and sidekiq)

- **Builder stage**: ruby:3.4-slim + build-essential, libpq-dev, libyaml-dev → bundle install
- **Runtime stage**: ruby:3.4-slim + libpq5 → copy bundle, copy app, chmod entrypoint + bin/rails
- web CMD: `bundle exec puma -b tcp://0.0.0.0:3000`
- sidekiq CMD override in compose.yml: `bundle exec sidekiq`

### compose.yml key points

- Only nginx port 80 exposed externally
- web and sidekiq share same `build: .` image
- PostgreSQL volume for persistence (db_data)
- Redis volume for persistence (redis_data)
- Dex entrypoint uses sed to substitute `__PLACEHOLDER__` vars in dex.yml
- Environment variables for all credentials

## Directory Structure

```
rails-mercari/
├── compose.yml
├── Dockerfile
├── .dockerignore
├── README.md
├── nginx.conf
├── dex.yml
├── init-db.sh
├── Gemfile
├── Gemfile.lock (empty)
├── Rakefile
├── config.ru
├── bin/
│   ├── docker-entrypoint
│   └── rails
├── config/
│   ├── application.rb
│   ├── boot.rb
│   ├── database.yml
│   ├── environment.rb
│   ├── environments/production.rb
│   ├── routes.rb
│   └── initializers/
│       ├── omniauth.rb
│       └── sidekiq.rb
├── app/
│   ├── controllers/
│   │   ├── application_controller.rb
│   │   ├── items_controller.rb
│   │   ├── purchases_controller.rb
│   │   └── sessions_controller.rb
│   ├── models/
│   │   ├── application_record.rb
│   │   ├── user.rb
│   │   ├── item.rb
│   │   └── purchase.rb
│   ├── jobs/
│   │   └── purchase_notification_job.rb
│   └── views/
│       ├── layouts/application.html.erb
│       ├── items/
│       │   ├── index.html.erb
│       │   └── _form.html.erb
│       └── shared/
│           └── _navbar.html.erb
└── db/
    ├── migrate/
    │   ├── 20260101000000_create_users.rb
    │   ├── 20260101000001_create_items.rb
    │   └── 20260101000002_create_purchases.rb
    └── schema.rb
```

## Session Management

- `session[:user_id]` for login state
- `current_user` helper in ApplicationController
- Items index visible without login
- Item creation, purchase require login (before_action)
- Users cannot buy their own items

## README Pattern

Follows repo convention (Japanese):
1. Title + description
2. 構成 (stack)
3. 前提条件
4. デプロイ (conoha server create → app init → app deploy)
5. 動作確認 (test users, flows)
6. カスタマイズ

## Test Users

| Email | Password | Role |
|-------|----------|------|
| seller@example.com | password | Sells items |
| buyer@example.com | password | Buys items |
