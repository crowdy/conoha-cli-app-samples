# nextjs-fastapi-clerk-stripe 設計書

Clerk 認証 + Stripe 決済を使った SaaS パターンのサンプルアプリ。Next.js をフロントエンド、FastAPI をバックエンドとし、PostgreSQL でデータを管理する。

## 1. 全体アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Next.js 15    │────▶│   FastAPI        │────▶│ PostgreSQL   │
│   (Frontend)    │ JWT │   (Backend)      │     │              │
│                 │     │                  │     │  - users     │
│  - Clerk SDK    │     │  - JWT 検証       │     │  - subscriptions│
│  - 料金プラン    │     │  - Stripe API    │     └──────────────┘
│  - ダッシュボード │     │  - Webhook 受信   │
└─────────────────┘     └─────────────────┘
         │                       │
         │                       │
    ┌────▼────┐           ┌──────▼──────┐
    │  Clerk  │           │   Stripe    │
    │  (認証)  │           │  (決済)      │
    └─────────┘           └─────────────┘
```

### サービス構成 (compose.yml)

- `frontend` — Next.js 15 (ポート 80:3000)
- `backend` — FastAPI (内部ポート 8000)
- `db` — PostgreSQL 17

### データフロー

1. ユーザーが Clerk でログイン → Next.js が Clerk セッション管理
2. Next.js → FastAPI 呼び出し時に Clerk JWT を Authorization ヘッダーで送信
3. FastAPI が Clerk JWKS で JWT 検証後、ビジネスロジック実行
4. Stripe Checkout/Customer Portal は FastAPI がセッション生成 → フロントがリダイレクト
5. Stripe Webhook → FastAPI が受信 → DB にサブスクリプション状態を同期

## 2. データベース設計

PostgreSQL に 2 テーブル。SQLAlchemy (asyncpg) 使用。アプリ起動時に `create_all` でテーブル作成。

### users テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | SERIAL PK | 内部 ID |
| clerk_user_id | VARCHAR UNIQUE | Clerk ユーザー ID (`user_xxx`) |
| stripe_customer_id | VARCHAR UNIQUE | Stripe 顧客 ID (`cus_xxx`) |
| email | VARCHAR | メールアドレス |
| created_at | TIMESTAMP | 作成日時 |

### subscriptions テーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | SERIAL PK | 内部 ID |
| user_id | INTEGER FK → users.id | ユーザー参照 |
| stripe_subscription_id | VARCHAR UNIQUE | Stripe サブスクリプション ID (`sub_xxx`) |
| stripe_price_id | VARCHAR | Stripe Price ID |
| plan | VARCHAR | `free` / `pro` / `enterprise` |
| status | VARCHAR | `active` / `canceled` / `past_due` 等 |
| current_period_end | TIMESTAMP | 現在の請求期間終了日 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

- Free プランユーザーは subscriptions レコードなし（Stripe サブスクリプションなしでデフォルト扱い）
- Webhook で `customer.subscription.updated/deleted` イベントにより subscriptions テーブルを同期

## 3. 料金プラン設計

| プラン | 月額 | 機能 | Stripe |
|--------|------|------|--------|
| Free | ¥0 | 基本機能のみ | サブスクリプションなし |
| Pro | ¥980/月 | 全機能 + 優先サポート | Stripe Checkout でサブスクリプション |
| Enterprise | ¥4,980/月 | 全機能 + チーム管理 + 専用サポート | Stripe Checkout でサブスクリプション |

### Stripe リソース (sandbox)

- Product 2 つ (Pro, Enterprise)
- Price 2 つ (月間 recurring, JPY 通貨)
- Stripe Checkout Session → FastAPI が生成、フロントがリダイレクト
- Stripe Customer Portal → サブスクリプション変更/解約用

### ユーザーフロー

1. **新規登録:** Clerk 会員登録 → Clerk Webhook (`user.created`) → FastAPI 受信 → Stripe Customer 作成 + users テーブル保存
2. **プラン購読:** 料金プランページで Pro/Enterprise 選択 → FastAPI が Checkout Session 生成 (`locale: 'ja'`, `currency: 'jpy'`) → Stripe 決済ページへリダイレクト → 決済完了 → Webhook (`checkout.session.completed`) → subscriptions テーブル保存
3. **プラン管理:** ダッシュボードで「サブスクリプション管理」クリック → FastAPI が Customer Portal Session 生成 → Stripe 管理ページへリダイレクト → 変更/解約 → Webhook (`customer.subscription.updated/deleted`) → DB 同期

### 処理する Webhook イベント

- `user.created` (Clerk → FastAPI)
- `checkout.session.completed` (Stripe → FastAPI)
- `customer.subscription.updated` (Stripe → FastAPI)
- `customer.subscription.deleted` (Stripe → FastAPI)

## 4. ページ構成・UI

### Next.js App Router ページ

| パス | 認証 | 説明 |
|------|------|------|
| `/` | 不要 | ランディングページ — サービス紹介 + 料金表示 + ログイン/会員登録ボタン |
| `/sign-in` | — | Clerk ログイン (Clerk コンポーネント) |
| `/sign-up` | — | Clerk 会員登録 (Clerk コンポーネント) |
| `/dashboard` | 必要 | ダッシュボード — 現在のプラン表示、サブスクリプション管理ボタン |
| `/pricing` | 不要 | 料金プランページ — Free/Pro/Enterprise 比較 + 購読ボタン（ログイン時） |

### UI 構成

- Tailwind CSS でスタイリング（UI ライブラリなし、シンプルに）
- ヘッダー: ロゴ + ナビゲーション + Clerk `<UserButton />`
- 料金カード: 3 列グリッド、現在のプランをハイライト
- ダッシュボード: 現在のプラン情報 + 請求期間 + 「プラン変更」/「サブスクリプション管理」ボタン
- 全体 UI は日本語

### Clerk ミドルウェア (Next.js)

- `/dashboard` は認証必須 → 未認証時は `/sign-in` へリダイレクト
- その他のページは公開

## 5. FastAPI バックエンド API 設計

### エンドポイント

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| GET | `/api/health` | 不要 | ヘルスチェック |
| POST | `/api/webhooks/clerk` | Clerk 署名検証 | Clerk Webhook 受信 (user.created) |
| POST | `/api/webhooks/stripe` | Stripe 署名検証 | Stripe Webhook 受信 |
| GET | `/api/subscription` | JWT 必要 | 現在ユーザーのサブスクリプション状態取得 |
| POST | `/api/checkout` | JWT 必要 | Stripe Checkout Session 生成 |
| POST | `/api/portal` | JWT 必要 | Stripe Customer Portal Session 生成 |

### プロジェクト構造

```
backend/
├── Dockerfile
├── requirements.txt
├── app/
│   ├── main.py              # FastAPI アプリ、ルーター登録
│   ├── config.py            # 環境変数設定
│   ├── database.py          # SQLAlchemy async エンジン/セッション
│   ├── models.py            # User, Subscription モデル
│   ├── auth.py              # Clerk JWT 検証 (PyJWKClient)
│   ├── routers/
│   │   ├── checkout.py      # /api/checkout, /api/portal
│   │   ├── subscription.py  # /api/subscription
│   │   └── webhooks.py      # /api/webhooks/clerk, /api/webhooks/stripe
│   └── services/
│       └── stripe_service.py  # Stripe API ラッピング
```

### 認証フロー

1. Next.js が Clerk から受け取った JWT を `Authorization: Bearer <token>` ヘッダーで送信
2. FastAPI `auth.py` で Clerk の JWKS エンドポイントから公開鍵を取得し JWT 検証
3. JWT payload の `sub` クレームで `clerk_user_id` を抽出 → users テーブル参照

### Webhook 署名検証

- Clerk: `svix` ライブラリで署名検証
- Stripe: `stripe` ライブラリの `Webhook.construct_event()` で検証

## 6. フロントエンド構造

```
frontend/
├── Dockerfile
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── middleware.ts             # Clerk 認証ミドルウェア
├── app/
│   ├── layout.tsx           # ClerkProvider + ヘッダー
│   ├── page.tsx             # ランディングページ
│   ├── globals.css          # Tailwind インポート
│   ├── pricing/
│   │   └── page.tsx         # 料金プランページ
│   ├── dashboard/
│   │   └── page.tsx         # ダッシュボード
│   ├── sign-in/[[...sign-in]]/
│   │   └── page.tsx         # Clerk ログイン
│   └── sign-up/[[...sign-up]]/
│       └── page.tsx         # Clerk 会員登録
└── lib/
    └── api.ts               # FastAPI 呼び出しユーティリティ (JWT 付与)
```

## 7. 環境変数

| 変数 | サービス | 説明 |
|------|----------|------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | frontend | Clerk 公開鍵 |
| `CLERK_SECRET_KEY` | frontend | Clerk シークレット (SSR 用) |
| `NEXT_PUBLIC_API_URL` | frontend | FastAPI URL (`http://localhost/api`) |
| `DATABASE_URL` | backend | PostgreSQL 接続文字列 |
| `STRIPE_SECRET_KEY` | backend | Stripe シークレットキー |
| `STRIPE_WEBHOOK_SECRET` | backend | Stripe Webhook 署名キー |
| `CLERK_WEBHOOK_SECRET` | backend | Clerk Webhook 署名キー |
| `CLERK_JWKS_URL` | backend | Clerk JWKS エンドポイント |
| `STRIPE_PRO_PRICE_ID` | backend | Pro プラン Price ID |
| `STRIPE_ENTERPRISE_PRICE_ID` | backend | Enterprise プラン Price ID |

`.env.example` にプレースホルダーを提供し、README に設定方法を案内する。

## 8. Docker 構成・デプロイ

### compose.yml

- `frontend`: Next.js 15, ポート 80:3000, backend に依存
- `backend`: FastAPI, 内部ポート 8000, db に依存, ヘルスチェック付き
- `db`: PostgreSQL 17, ボリュームマウント, ヘルスチェック付き

### Dockerfile

- **frontend:** 既存 nextjs サンプルと同様のマルチステージビルド (deps → builder → runner)
- **backend:** Python 3.12-slim, pip install, uvicorn 実行

### 推奨フレーバー

`g2l-t-2` (2GB) — Next.js + FastAPI + PostgreSQL は 2GB で十分

### デプロイ手順

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
cd nextjs-fastapi-clerk-stripe
conoha app init myserver --app-name nextjs-fastapi-clerk-stripe
conoha app deploy myserver --app-name nextjs-fastapi-clerk-stripe
```
