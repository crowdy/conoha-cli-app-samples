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
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## ⚠ 既知の制限: Webhook エンドポイントが公開できない

**このサンプルは現行の conoha-proxy 構成だけでは完全には動作しません**。Clerk / Stripe Webhook は `backend:8000` が外部から直接受け取る必要があり、Webhook 署名検証は request body の byte 列を HMAC で検証するため Next.js の rewrite 経由では通らず、かつ conoha-proxy は FQDN あたり 1 サービスしかフロントできないためです。

Subscription 決済の状態反映フロー（`Checkout → Webhook → DB 更新`）がこの制限の影響を受けます。**sign-in / sign-up / Stripe Checkout へのリダイレクト自体は正常に動作します**。

### 当面の回避策

1. **backend を別 `conoha.yml` プロジェクトに切り出す**（`api.example.com` サブドメイン）: webhook URL を `https://api.example.com/api/webhooks/stripe` に設定。future batch で対応検討中。
2. **開発時のみ Stripe CLI の webhook forwarding を使う**: `stripe listen --forward-to http://localhost:8000/...` をローカル端末で起動して、SSH tunnel 経由でサーバー上の backend に届ける。本番には不向き。

## セットアップ

### 1. Clerk の設定

1. [Clerk Dashboard](https://dashboard.clerk.com) でアプリケーションを作成
2. Publishable Key と Secret Key をメモ
3. Webhooks 設定（**現行 layout では届きません** — subdomain split 後に有効化）:
   - エンドポイント URL: `https://api.<あなたの FQDN>/api/webhooks/clerk`
   - イベント: `user.created`
4. JWKS URL をメモ

### 2. Stripe の設定

1. [Stripe Dashboard](https://dashboard.stripe.com/test) でテストモードを確認
2. Product を 2 つ作成:
   - **Pro**: ¥980/月（recurring, JPY）
   - **Enterprise**: ¥4,980/月（recurring, JPY）
3. 各 Product の Price ID をメモ
4. Webhooks 設定（**現行 layout では届きません** — subdomain split 後に有効化）:
   - エンドポイント URL: `https://api.<あなたの FQDN>/api/webhooks/stripe`
5. Customer Portal を有効化

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

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

1. ブラウザで `https://<あなたの FQDN>` にアクセス（初回は Let's Encrypt 証明書発行に数十秒かかります）
2. 「無料で始める」から会員登録 — Clerk の sign-in / sign-up は動作します
3. 料金プランページで Pro または Enterprise を選択 → Stripe Checkout へリダイレクト（動作）
4. テストカード `4242 4242 4242 4242` で決済（動作）
5. **Webhook が届かないためサブスクリプション状態は自動更新されません** — 上述回避策を参照

## 料金プラン

| プラン | 月額 | 機能 |
|--------|------|------|
| Free | ¥0 | 基本機能のみ |
| Pro | ¥980/月 | 全機能 + 優先サポート |
| Enterprise | ¥4,980/月 | 全機能 + チーム管理 + 専用サポート |
