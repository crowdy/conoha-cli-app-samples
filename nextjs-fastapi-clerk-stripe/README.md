# nextjs-fastapi-clerk-stripe

Clerk 認証 + Stripe サブスクリプション決済の SaaS デモアプリです。Next.js フロントエンド + FastAPI バックエンド + PostgreSQL の構成で、料金プラン選択から Stripe Checkout での決済、Customer Portal でのサブスクリプション管理までの一連のフローを実装しています。

## 構成

- Next.js 16 (App Router, standalone) + shadcn/ui — フロントエンド + Clerk 認証
- FastAPI — バックエンド API + Stripe 連携 + Webhook 処理
- PostgreSQL 17 — ユーザー・サブスクリプションデータ
- Clerk — 認証・ユーザー管理
- Stripe (sandbox) — サブスクリプション決済
- ポート: 80

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- [Clerk](https://clerk.com) アカウント
- [Stripe](https://stripe.com) アカウント（テストモード）

## セットアップ

### 1. Clerk の設定

1. [Clerk Dashboard](https://dashboard.clerk.com) でアプリケーションを作成
2. Publishable Key と Secret Key をメモ
3. Webhooks 設定で以下を追加:
   - エンドポイント URL: `http://<サーバーIP>/api/webhooks/clerk`
   - イベント: `user.created`
   - Signing Secret をメモ
4. JWKS URL をメモ（`https://<your-app>.clerk.accounts.dev/.well-known/jwks.json`）

### 2. Stripe の設定

1. [Stripe Dashboard](https://dashboard.stripe.com/test) でテストモードを確認
2. Product を 2 つ作成:
   - **Pro**: ¥980/月（recurring, JPY）
   - **Enterprise**: ¥4,980/月（recurring, JPY）
3. 各 Product の Price ID をメモ（`price_xxxxx`）
4. Webhooks 設定で以下を追加:
   - エンドポイント URL: `http://<サーバーIP>/api/webhooks/stripe`
   - イベント: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Webhook Signing Secret をメモ
5. Customer Portal を有効化:
   - [設定](https://dashboard.stripe.com/test/settings/billing/portal) でサブスクリプションの変更・解約を許可

### 3. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して各キーを設定
```

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name nextjs-fastapi-clerk-stripe

# デプロイ
conoha app deploy myserver --app-name nextjs-fastapi-clerk-stripe
```

## 動作確認

1. ブラウザで `http://<サーバーIP>` にアクセス
2. 「無料で始める」から会員登録
3. 料金プランページで Pro または Enterprise を選択
4. Stripe Checkout で決済（テストカード: `4242 4242 4242 4242`）
5. ダッシュボードでサブスクリプション状態を確認
6. 「サブスクリプション管理」から Stripe Customer Portal でプラン変更・解約

## 料金プラン

| プラン | 月額 | 機能 |
|--------|------|------|
| Free | ¥0 | 基本機能のみ |
| Pro | ¥980/月 | 全機能 + 優先サポート |
| Enterprise | ¥4,980/月 | 全機能 + チーム管理 + 専用サポート |
