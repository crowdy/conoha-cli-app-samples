---
title: Clerk認証 + Stripeサブスクリプション決済のSaaSデモをConoHa VPSにデプロイした話（Next.js 16 + FastAPI）
tags: Conoha conoha-cli Next.js FastAPI Clerk Stripe SaaS shadcn/ui
author: crowdy
slide: false
---
## はじめに

SaaSアプリを作るとき、認証と決済は避けて通れない2大テーマです。今回は **Clerk**（認証）と **Stripe**（サブスクリプション決済）を組み合わせたSaaSデモアプリを、**conoha-cli** でConoHa VPSにデプロイしました。

構成は Next.js 16（フロントエンド）+ FastAPI（バックエンドAPI）+ PostgreSQL（データベース）の3層構成。ただし今回は最新バージョン縛りにしたため、**Clerk v7 + Next.js 16 + shadcn/ui v4** という組み合わせで、まだ情報が少ない領域に踏み込むことになりました。

結論から言うと、動くようになりましたが、いくつかの「ハマりポイント」がありました。同じ構成を試す方の参考になればと思い、失敗と対応も含めて記録します。

## 完成したアプリ

| ページ | 機能 |
|--------|------|
| `/` | ランディングページ（サービス紹介 + CTA） |
| `/sign-in`, `/sign-up` | Clerk認証（日本語UI） |
| `/pricing` | 料金プラン（Free / Pro ¥980 / Enterprise ¥4,980） |
| `/dashboard` | サブスクリプション状態表示 + 管理 |

ログインすると料金プランページに「このプランを選択」ボタンが表示され、クリックするとStripe Checkout（日本語）で決済。完了後ダッシュボードにプランが反映されます。

### アーキテクチャ

```
ブラウザ → :80 → [frontend (Next.js 16)]
                      │
                      │ rewrites /api/* → backend:8000/api/*
                      ▼
                  [backend (FastAPI)] ← :8000 ← Stripe/Clerk Webhook
                      │
                      │ asyncpg
                      ▼
                  [db (PostgreSQL 17)]
```

外部公開ポートは **80**（フロントエンド）と **8000**（Webhook受信用）の2つ。

### 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | Next.js 16 + React 19 + Tailwind CSS v4 + shadcn/ui v4 |
| 認証 | Clerk v7（@clerk/nextjs 7.1.0） |
| バックエンドAPI | FastAPI + SQLAlchemy (async) + Pydantic |
| 決済 | Stripe Checkout + Customer Portal（sandbox） |
| DB | PostgreSQL 17 |
| デプロイ | conoha-cli + Docker Compose |

## ファイル構成

```
nextjs-fastapi-clerk-stripe/
├── compose.yml
├── .env.example
├── .env.server          # デプロイ時にサーバーにコピーされる
├── frontend/
│   ├── Dockerfile       # node:22 マルチステージビルド
│   ├── package.json
│   ├── next.config.ts   # rewrites + standalone
│   ├── proxy.ts         # Clerk認証プロキシ（※後述）
│   ├── components/ui/   # shadcn/ui コンポーネント
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx
│       ├── pricing/page.tsx
│       ├── dashboard/page.tsx
│       ├── sign-in/[[...sign-in]]/page.tsx
│       └── sign-up/[[...sign-up]]/page.tsx
└── backend/
    ├── Dockerfile       # python:3.12-slim
    ├── requirements.txt
    └── app/
        ├── main.py      # FastAPI + lifespan
        ├── config.py    # pydantic-settings
        ├── database.py  # async SQLAlchemy
        ├── models.py    # User + Subscription
        ├── auth.py      # Clerk JWT検証
        ├── routers/
        │   ├── checkout.py     # Stripe Checkout/Portal
        │   ├── subscription.py # サブスクリプション状態取得
        │   └── webhooks.py     # Clerk/Stripe Webhook
        └── services/
            └── stripe_service.py
```

## 全体の流れ

### 1. ユーザー登録フロー

```
Clerk会員登録 → Clerk Webhook (user.created) → FastAPI
  → Stripe Customer作成 → usersテーブルに保存
```

### 2. サブスクリプション購入フロー

```
料金プランで「このプランを選択」クリック
  → FastAPIがStripe Checkout Session作成
  → Stripe決済ページ（日本語）にリダイレクト
  → 決済完了
  → Stripe Webhook (checkout.session.completed) → FastAPI
  → subscriptionsテーブルに保存
  → ダッシュボードに反映
```

### 3. サブスクリプション管理フロー

```
ダッシュボードで「サブスクリプション管理」クリック
  → FastAPIがStripe Customer Portal Session作成
  → Stripe管理ページにリダイレクト
  → プラン変更/解約
  → Stripe Webhook (customer.subscription.updated/deleted) → FastAPI
  → DBに反映
```

## 環境変数の一覧

以下の環境変数をすべて設定する必要があります。`.env.server` に記述しておくと、`conoha app deploy` 時にサーバー上の `.env` に自動コピーされます。

| 変数名 | サービス | 説明 | 取得方法 |
|--------|----------|------|----------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | frontend | Clerk公開鍵（`pk_test_xxx`） | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | frontend | Clerkシークレット（`sk_test_xxx`） | Clerk Dashboard → API Keys |
| `CLERK_JWKS_URL` | backend | Clerk JWKS URL | Publishable Keyをbase64デコードしてドメイン取得 → `https://<domain>/.well-known/jwks.json` |
| `CLERK_WEBHOOK_SECRET` | backend | Clerk Webhook署名キー（`whsec_xxx`） | Svix API経由で取得（後述） |
| `STRIPE_SECRET_KEY` | backend | Stripeシークレットキー（`sk_test_xxx`） | Stripe Dashboard → API Keys |
| `STRIPE_WEBHOOK_SECRET` | backend | Stripe Webhook署名キー（`whsec_xxx`） | Stripe API経由で取得（後述） |
| `STRIPE_PRO_PRICE_ID` | backend | Proプランの Price ID（`price_xxx`） | Stripe API経由で作成（後述） |
| `STRIPE_ENTERPRISE_PRICE_ID` | backend | EnterpriseプランのPrice ID（`price_xxx`） | Stripe API経由で作成（後述） |

### CLERK_JWKS_URL の求め方

Publishable Key にClerkのドメインがbase64エンコードされています。

```bash
echo "pk_test_bWF4aW11bS1iaXJkLTkyLmNsZXJrLmFjY291bnRzLmRldiQ" | sed 's/pk_test_//' | base64 -d
# → maximum-bird-92.clerk.accounts.dev
# → CLERK_JWKS_URL=https://maximum-bird-92.clerk.accounts.dev/.well-known/jwks.json
```

## 事前準備：Clerk/Stripe をAPIで設定

今回はすべてAPIで設定しました。ダッシュボードにログインできない環境でも使えます。

### Clerk の設定

#### 1. アプリケーション作成

[Clerk Dashboard](https://dashboard.clerk.com/apps) でアプリを作成し、API Keys ページから Publishable Key と Secret Key を取得します。

#### 2. allowed_origins の設定（HTTP環境の場合）

開発キー（`pk_test_`）でHTTP環境を使う場合、CORSエラーを防ぐために設定が必要です。

```bash
curl -X PATCH https://api.clerk.com/v1/instance \
  -H "Authorization: Bearer $CLERK_KEY" \
  -H "Content-Type: application/json" \
  -d '{"allowed_origins": ["http://<サーバーIP>"]}'
```

#### 3. リダイレクトURLの設定

ログイン後にClerkのデフォルトページに飛ばされないように、ホームURLを設定します。

```bash
curl -X PATCH https://api.clerk.com/v1/instance \
  -H "Authorization: Bearer $CLERK_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "home_url": "http://<サーバーIP>",
    "sign_in_url": "http://<サーバーIP>/sign-in",
    "sign_up_url": "http://<サーバーIP>/sign-up",
    "after_sign_in_url": "http://<サーバーIP>/dashboard",
    "after_sign_up_url": "http://<サーバーIP>/dashboard"
  }'
```

#### 4. Webhook の作成（Svix API経由）

Clerkの内部WebhookシステムはSvixで動いています。APIでエンドポイントを作成し、署名キーを取得します。

```bash
# Step 1: Svixダッシュボード用URLを取得
SVIX_DATA=$(curl -s -X POST https://api.clerk.com/v1/webhooks/svix_url \
  -H "Authorization: Bearer $CLERK_KEY")

# Step 2: ワンタイムトークンを抽出
SVIX_KEY_B64=$(echo "$SVIX_DATA" | python3 -c "
import sys,json
url=json.load(sys.stdin)['svix_url']
print(url.split('key=')[1])
")
SVIX_JSON=$(echo "$SVIX_KEY_B64" | base64 -d)
APP_ID=$(echo "$SVIX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['appId'])")
TOKEN=$(echo "$SVIX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['oneTimeToken'])")
REGION=$(echo "$SVIX_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['region'])")

# Step 3: APIトークンに交換
SVIX_TOKEN=$(curl -s -X POST "https://api.${REGION}.svix.com/api/v1/auth/one-time-token" \
  -H "Content-Type: application/json" \
  -d "{\"oneTimeToken\":\"$TOKEN\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Step 4: エンドポイント作成
ENDPOINT=$(curl -s -X POST "https://api.${REGION}.svix.com/api/v1/app/${APP_ID}/endpoint" \
  -H "Authorization: Bearer $SVIX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"http://<サーバーIP>:8000/api/webhooks/clerk\",\"filterTypes\":[\"user.created\"]}")
ENDPOINT_ID=$(echo "$ENDPOINT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Step 5: 署名キーを取得 → CLERK_WEBHOOK_SECRET として使用
curl -s "https://api.${REGION}.svix.com/api/v1/app/${APP_ID}/endpoint/${ENDPOINT_ID}/secret" \
  -H "Authorization: Bearer $SVIX_TOKEN"
# → {"key": "whsec_xxxxx"}
```

> **注意**: Svixのワンタイムトークンは短時間で失効します。Step 1〜5 を一気に実行してください。

### Stripe の設定

#### 1. Product と Price の作成

Stripe sandbox（テストモード）でProductとPriceを作成します。

```bash
STRIPE_KEY=$(cat ~/.config/planitai/stripe/secret-key)

# Proプラン（¥980/月）
PRO_PRODUCT=$(curl -s -X POST https://api.stripe.com/v1/products \
  -u "$STRIPE_KEY:" -d "name=Pro Plan" -d "description=全機能 + 優先サポート" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

PRO_PRICE=$(curl -s -X POST https://api.stripe.com/v1/prices \
  -u "$STRIPE_KEY:" \
  -d "product=$PRO_PRODUCT" -d "currency=jpy" -d "unit_amount=980" \
  -d "recurring[interval]=month" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Enterpriseプラン（¥4,980/月）
ENT_PRODUCT=$(curl -s -X POST https://api.stripe.com/v1/products \
  -u "$STRIPE_KEY:" -d "name=Enterprise Plan" -d "description=全機能 + チーム管理 + 専用サポート" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

ENT_PRICE=$(curl -s -X POST https://api.stripe.com/v1/prices \
  -u "$STRIPE_KEY:" \
  -d "product=$ENT_PRODUCT" -d "currency=jpy" -d "unit_amount=4980" \
  -d "recurring[interval]=month" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "STRIPE_PRO_PRICE_ID=$PRO_PRICE"
echo "STRIPE_ENTERPRISE_PRICE_ID=$ENT_PRICE"
```

#### 2. Webhook エンドポイントの作成

```bash
WEBHOOK=$(curl -s -X POST https://api.stripe.com/v1/webhook_endpoints \
  -u "$STRIPE_KEY:" \
  -d "url=http://<サーバーIP>:8000/api/webhooks/stripe" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=customer.subscription.updated" \
  -d "enabled_events[]=customer.subscription.deleted")

echo "STRIPE_WEBHOOK_SECRET=$(echo $WEBHOOK | python3 -c "import sys,json; print(json.load(sys.stdin)['secret'])")"
```

> **重要**: WebhookのURLはNext.jsのrewrite（ポート80）ではなく、**FastAPIに直接届くポート8000**を指定してください。rewrite経由だとリクエストボディが変更され、署名検証が失敗します。

#### 3. Customer Portal の有効化

Stripe Dashboard（[設定ページ](https://dashboard.stripe.com/test/settings/billing/portal)）で Customer Portal を有効化し、サブスクリプションの変更・解約を許可してください。これはAPIでは設定できないため、ダッシュボードでの操作が必要です。

### .env.server の例

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
CLERK_WEBHOOK_SECRET=whsec_xxxxx
CLERK_JWKS_URL=https://your-app.clerk.accounts.dev/.well-known/jwks.json
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_ENTERPRISE_PRICE_ID=price_xxxxx
```

## デプロイ手順

### 1. サーバー作成

```bash
conoha server create --name saas-demo \
  --flavor g2l-t-c3m2 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name mykey \
  --security-group default \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --yes --wait
```

Docker入りのイメージを使うのがポイント。`app init` のDocker インストール時間を短縮できます。

### 2. Webhook用ポートの開放

Stripe/Clerk Webhookはバックエンドに直接届く必要があるため、ポート8000を開放します。

```bash
conoha server add-security-group saas-demo --name 3000-9999 --yes
```

### 3. 環境変数を設定

`.env.server` にClerk/Stripeの各種キーを設定します。このファイルは `conoha app deploy` 時にサーバー上の `.env` にコピーされます。

### 4. デプロイ

```bash
cd nextjs-fastapi-clerk-stripe
conoha app init saas-demo --app-name nextjs-fastapi-clerk-stripe
conoha app deploy saas-demo --app-name nextjs-fastapi-clerk-stripe
```

## ハマりポイント（9つ）

### 1. Clerk v7 で `SignedIn` / `SignedOut` が廃止

**症状**: ビルド時に `Export SignedIn doesn't exist in target module` エラー。

**原因**: Clerk v7では `SignedIn` / `SignedOut` コンポーネントが削除され、`Show` コンポーネントに統合されました。

**対応**:
```tsx
// ❌ Clerk v6
import { SignedIn, SignedOut } from "@clerk/nextjs";
<SignedIn>...</SignedIn>
<SignedOut>...</SignedOut>

// ✅ Clerk v7
import { Show } from "@clerk/nextjs";
<Show when="signed-in">...</Show>
<Show when="signed-out">...</Show>
```

### 2. shadcn/ui v4 で `asChild` が `render` に変更

**症状**: `Property 'asChild' does not exist` ビルドエラー。

**原因**: shadcn/ui v4はRadix UIから `@base-ui/react` に移行し、`asChild` パターンが `render` propに変更されました。

**対応**:
```tsx
// ❌ shadcn/ui v3
<Button asChild><Link href="/pricing">料金</Link></Button>

// ✅ shadcn/ui v4
<Button render={<Link href="/pricing" />}>料金</Button>
```

### 3. Next.js 16 で `middleware.ts` が `proxy.ts` に名称変更

**症状**: `The "middleware" file convention is deprecated. Please use "proxy" instead.`

**原因**: Next.js 16でmiddlewareファイルがproxyに改名されました。

**対応**: `middleware.ts` → `proxy.ts` にリネーム。**default exportで `clerkMiddleware()` を返すだけでOKです**。

```typescript
// ✅ proxy.ts — シンプルなdefault export
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

なお、`default export` を使うとedge runtimeで実行されます。named export `proxy` を使うとnode runtimeになりますが、Next.js 16の `output: "standalone"` ではnode runtimeのproxy出力にバグがあり（[vercel/next.js#91600](https://github.com/vercel/next.js/issues/91600)）、Dockerデプロイでは `default export`（edge runtime）を推奨します。

### 4. HTTP環境でClerkのサーバーサイド認証が動かない

**症状**: ログイン後に `/dashboard` にリダイレクトされず、`/sign-in` とのリダイレクトループが発生。コンソールに `Suffixed cookie failed due to Cannot read properties of undefined (reading 'digest')` エラー。

**原因**: ブラウザはHTTPS以外の環境で `crypto.subtle` API を提供しません。Clerkの開発モードはこのAPIを使ってセッションCookieを生成するため、HTTP環境ではサーバーサイドで認証状態を読み取れません。

一方、クライアントサイドのClerk JSは `accounts.dev` ドメイン経由のセッションで認証状態を把握できます。

**対応**: Server Componentsでの `auth()` 依存をやめ、**クライアントコンポーネント**に切り替えました。

```tsx
// ❌ Server Component（HTTP環境で失敗）
import { auth } from "@clerk/nextjs/server";
export default async function Dashboard() {
  const { userId } = await auth();  // ← ここで失敗
  ...
}

// ✅ Client Component（HTTP環境でも動作）
"use client";
import { useAuth } from "@clerk/nextjs";
export default function Dashboard() {
  const { isSignedIn, getToken } = useAuth();
  // クライアントでJWTを取得してAPIを呼ぶ
  const token = await getToken();
  fetch("/api/subscription", { headers: { Authorization: `Bearer ${token}` } });
}
```

proxy.tsからも `auth.protect()` を削除し、認証チェックはクライアント側で行うようにしました。

> **補足**: HTTPS環境（本番）であればServer Componentsでの `auth()` も正常に動作します。

### 5. Webhook署名検証の失敗（Next.js rewrite経由）

**症状**: Stripe Webhookが `400 Bad Request` で失敗。

**原因**: Webhookがポート80のNext.jsに届き、rewriteでバックエンドに転送される過程でリクエストボディが変更され、Stripe署名検証が失敗しました。

**対応**: バックエンドのポート8000を外部に公開し、WebhookのURLを直接バックエンドに向けるように変更しました。

```yaml
# compose.yml
backend:
  ports:
    - "8000:8000"  # exposeからportsに変更
```

```
Webhook URL: http://<サーバーIP>:8000/api/webhooks/stripe
```

### 6. 環境変数のtypoで「curlは通るのにブラウザだけエラー」になる

**症状**: curlでは200が返るのに、ブラウザでアクセスするとInternal Server Errorになる。ログには `auth() was called but Clerk can't detect usage of clerkMiddleware()` が出る。

**原因**: `.env` の `CLERK_SECRET_KEY` が不正（コピペミス等）。Clerkはブラウザアクセス時にhandshakeフローを実行し、その検証に `CLERK_SECRET_KEY` を使います。キーが不正だとhandshakeが失敗し、SSRで `auth()` がmiddlewareのコンテキストを検出できなくなります。

curlからはhandshakeフローが発生しないため正常に200が返り、ブラウザからのみエラーになります。エラーメッセージもmiddleware設定を疑わせる内容なので、環境変数のtypoが原因だと気づきにくいのが厄介です。

**対応**: フロントエンドのログに以下のメッセージがないか確認する。

```
Error: Clerk: Handshake token verification failed:
  The provided Clerk Secret Key is invalid.
  (reason=secret-key-invalid, token-carrier=undefined)
```

このメッセージが出ていたら、`.env` の `CLERK_SECRET_KEY` を再確認してください。キーの末尾が切れていないか、余分な空白がないか注意が必要です。

> **補足**: named export `proxy`（node runtime）を使う場合、Next.js 16の `output: "standalone"` にはバグがあり（[vercel/next.js#91600](https://github.com/vercel/next.js/issues/91600)）、middleware関連ファイルがstandalone出力に含まれません。default export（edge runtime）に切り替えることで `middleware-manifest.json` が正しく生成されるようになります。

### 7. Clerkログイン後に `accounts.dev/default-redirect` に飛ばされる

**症状**: ログイン完了後、自分のアプリではなく `https://xxx.accounts.dev/default-redirect` に遷移して止まる。

**原因**: ClerkアプリケーションにホームURLやリダイレクトURLが設定されていない。Clerkはログイン後のリダイレクト先がわからず、デフォルトページを表示する。

**対応**: Clerk APIでURLを設定し、`compose.yml` のビルド引数でもフォールバックURLを指定。

```bash
# Clerk APIで設定
curl -X PATCH https://api.clerk.com/v1/instance \
  -H "Authorization: Bearer $CLERK_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "home_url": "http://<サーバーIP>",
    "sign_in_url": "http://<サーバーIP>/sign-in",
    "sign_up_url": "http://<サーバーIP>/sign-up",
    "after_sign_in_url": "http://<サーバーIP>/dashboard",
    "after_sign_up_url": "http://<サーバーIP>/dashboard"
  }'
```

```yaml
# compose.yml - フロントエンドのビルド引数
frontend:
  build:
    context: ./frontend
    args:
      - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
  environment:
    - NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
    - NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
    - NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
    - NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` はビルド時に埋め込む必要があるため、`build.args` に指定します。Dockerfileにも対応する `ARG` が必要です。

```dockerfile
# Dockerfile（builderステージ）
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ARG NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
ARG NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
RUN npm run build
```

### 8. クライアントコンポーネントの `useSearchParams` でプリレンダリングエラー

**症状**: ビルド時に `Error occurred prerendering page "/dashboard"` でビルド失敗。

**原因**: dashboardページをクライアントコンポーネント (`"use client"`) に変更した際、`useSearchParams()` を使用。Next.js 16はクライアントコンポーネントもプリレンダリングしようとするが、`useSearchParams` はプリレンダリング時に値を返せないため失敗する。

**対応**: `useSearchParams` を使用するコンポーネントを `Suspense` で囲む。

```tsx
function DashboardContent() {
  const searchParams = useSearchParams();  // ← プリレンダリング不可
  // ...
}

// ページエクスポートはSuspenseで囲む
export default function DashboardPage() {
  return (
    <Suspense fallback={<div>読み込み中...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
```

### 9. Next.js 16 standaloneビルドとproxy/middleware

**注意**: `proxy.ts` で **default export**（edge runtime）を使えば、standaloneビルドにmiddlewareファイルが自動的に含まれます。Dockerfileでの手動COPYは不要です。

```dockerfile
# ✅ これだけでOK（edge runtimeのmiddlewareは自動包含）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
```

一方、**named export `proxy`**（node runtime）を使う場合は、Next.js 16のバグ（[vercel/next.js#91600](https://github.com/vercel/next.js/issues/91600)）により `middleware.js` がstandalone出力にコピーされません。手動でDockerfileにCOPY行を追加する必要がありますが、さらに `middleware-manifest.json` も空になるためClerkの `auth()` 検出にも問題が出ます。

**結論**: Docker + standalone環境では **default export**（edge runtime）を使ってください。

## JWT認証のフォールバック

Clerk Webhookが遅延したり失敗した場合、ユーザーがDBに未登録の状態でAPIが呼ばれることがあります。これに対応するため、JWT認証時にユーザーが見つからなければ**自動作成するフォールバック**を実装しました。

```python
# auth.py
user = result.scalar_one_or_none()
if not user:
    # Webhook未到着の場合のフォールバック
    customer = stripe.Customer.create(email=email, metadata={"clerk_user_id": clerk_user_id})
    user = User(clerk_user_id=clerk_user_id, stripe_customer_id=customer.id, email=email)
    db.add(user)
    await db.commit()
```

## まとめ

| 項目 | 内容 |
|------|------|
| デプロイ対象 | Next.js 16 + FastAPI + Clerk + Stripe + PostgreSQL 17 |
| 必要コマンド | `app init` + `app deploy` の2つ |
| ローカル環境の要件 | conoha-cli のみ（Node.js/Python不要） |
| 推奨フレーバー | g2l-t-c3m2（3 vCPU, 2GB RAM） |
| 外部公開ポート | 80（フロントエンド）+ 8000（Webhook） |
| ソースコード | [crowdy/conoha-cli-app-samples](https://github.com/crowdy/conoha-cli-app-samples/tree/main/nextjs-fastapi-clerk-stripe) |

最新バージョン（Clerk v7 + Next.js 16 + shadcn/ui v4）の組み合わせは、2026年4月時点ではまだエッジケースが多く、ドキュメント通りにいかない場面がいくつかありました。特に **HTTP環境でのClerk認証** と **Next.js 16のproxy規約** は注意が必要です。

一方、conoha-cliの `app deploy` は今回も安定しており、Clerk/Stripeの設定さえ完了すればワンコマンドでデプロイできました。SaaSの雛形として、ぜひ活用してみてください。

### 参考

- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [Clerk v7 Migration Guide](https://clerk.com/docs/upgrade-guides/clerk-v7)
- [Next.js 16 Upgrade Guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Stripe Checkout Quickstart](https://docs.stripe.com/checkout/quickstart)
