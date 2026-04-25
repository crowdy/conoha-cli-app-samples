# nextjs-fastapi-clerk-stripe

Clerk 認証 + Stripe サブスクリプション決済の SaaS デモアプリです。Next.js フロントエンド + FastAPI バックエンド + PostgreSQL の構成で、料金プラン選択から Stripe Checkout での決済、Customer Portal でのサブスクリプション管理までの一連のフローを実装しています。

`conoha-cli >= v0.6.1` が必要です（`expose:` ブロックの blue/green 制御に v0.6.1 のバグ修正が含まれます）。

## 構成

- Next.js 16 (App Router, standalone) + shadcn/ui — フロントエンド + Clerk 認証
- FastAPI — バックエンド API + Stripe 連携 + Webhook 処理
- PostgreSQL 17 — ユーザー・サブスクリプションデータ
- Clerk — 認証・ユーザー管理
- Stripe (sandbox) — サブスクリプション決済
- ポート: 80 / 443 (HTTPS)

## アーキテクチャ

```
                       ┌─────────────────────────────────┐
   Browser ──HTTPS──▶  │ conoha-proxy (Caddy + ACME)    │
                       └──┬──────────────────────────┬──┘
                          │ <root>.example.com       │ api.example.com
                          ▼                          ▼
                       frontend (Next.js :3000)   backend (FastAPI :8000)
                          │                          │
                          │ BACKEND_INTERNAL_URL     │
                          └────▶ backend:8000 ◀──────┘
                                                     │
   Clerk / Stripe webhooks ─────HTTPS────────────────┘
   POST https://api.example.com/api/webhooks/{clerk,stripe}
                                                     │
                                                     ▼
                                                   db (Postgres)
```

Webhook は `api.example.com` に直接届くため、Next.js の rewrite を経由せず request body の byte 列がそのまま FastAPI に渡ります（HMAC 署名検証が成立します）。

## 前提条件

- conoha-cli (>= v0.6.1) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- [Clerk](https://clerk.com) アカウント
- [Stripe](https://stripe.com) アカウント（テストモード）
- 公開する 2 つの FQDN の DNS A レコードが同じサーバー IP を指している
  - 例: `app.example.com`（Next.js）と `api.example.com`（FastAPI）

## セットアップ

### 1. Clerk の設定

1. [Clerk Dashboard](https://dashboard.clerk.com) でアプリケーションを作成
2. Publishable Key と Secret Key をメモ
3. Webhooks を作成:
   - エンドポイント URL: `https://api.<あなたの FQDN>/api/webhooks/clerk`
   - イベント: `user.created`
   - Signing Secret (`whsec_...`) をメモ
4. JWKS URL をメモ（`https://<your-clerk-frontend-api>/.well-known/jwks.json`）

### 2. Stripe の設定

1. [Stripe Dashboard](https://dashboard.stripe.com/test) でテストモードを確認
2. Product を 2 つ作成:
   - **Pro**: ¥980/月（recurring, JPY）
   - **Enterprise**: ¥4,980/月（recurring, JPY）
3. 各 Product の Price ID をメモ
4. Webhooks を作成:
   - エンドポイント URL: `https://api.<あなたの FQDN>/api/webhooks/stripe`
   - 受信するイベント: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Signing Secret (`whsec_...`) をメモ
5. Customer Portal を有効化

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` (root) と `expose[].host` (api) を自分の FQDN に書き換える
#    - hosts:           app.example.com
#    - expose[0].host:  api.example.com
#    両方の DNS A レコードがサーバー IP を指している必要があります。

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定
conoha app env set myserver \
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx \
  CLERK_SECRET_KEY=sk_test_xxx \
  CLERK_WEBHOOK_SECRET=whsec_xxx \
  CLERK_JWKS_URL=https://xxx.clerk.accounts.dev/.well-known/jwks.json \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxx \
  STRIPE_PRO_PRICE_ID=price_xxx \
  STRIPE_ENTERPRISE_PRICE_ID=price_xxx

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

1. ブラウザで `https://<root FQDN>` にアクセス（初回は Let's Encrypt 証明書発行に数十秒かかります）
2. `https://api.<FQDN>/api/health` が `{"status":"ok"}` を返すことを確認
3. 「無料で始める」から会員登録 → Clerk webhook が `api.<FQDN>` に届き、ユーザーが DB に作成されます
4. 料金プランページで Pro または Enterprise を選択 → Stripe Checkout へリダイレクト
5. テストカード `4242 4242 4242 4242` で決済
6. Stripe webhook が `api.<FQDN>` に届き、サブスクリプションが `subscriptions` テーブルに反映されます
7. ダッシュボードで現在のプランが表示されることを確認

## 料金プラン

| プラン | 月額 | 機能 |
|--------|------|------|
| Free | ¥0 | 基本機能のみ |
| Pro | ¥980/月 | 全機能 + 優先サポート |
| Enterprise | ¥4,980/月 | 全機能 + チーム管理 + 専用サポート |
