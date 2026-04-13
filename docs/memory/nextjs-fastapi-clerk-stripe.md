# nextjs-fastapi-clerk-stripe 作業メモ

2026-04-13 の作業セッションで得た情報。別のマシンで作業を続ける際の引き継ぎ用。

## デプロイ済み環境

| 項目 | 値 |
|------|-----|
| ConoHa サーバー名 | saas-demo |
| IP | 160.251.237.88 |
| フレーバー | g2l-t-c3m2 (3 vCPU, 2GB RAM) |
| イメージ | vmi-docker-29.2-ubuntu-24.04-amd64 |
| SSH キー | tkim-cli-test-key (ファイル: `~/.ssh/conoha_tkim-cli-test-key`) |
| セキュリティグループ | default, IPv4v6-SSH, IPv4v6-Web, 3000-9999 |
| フロントエンド | http://160.251.237.88 (ポート 80) |
| バックエンドAPI | http://160.251.237.88:8000 (Webhook 受信用) |

## APIキーの場所

| キー | 場所 |
|------|------|
| Clerk keys (PUBLISHABLE + SECRET) | `~/.config/planitai/clerk/keys` |
| Stripe secret key | `~/.config/planitai/stripe/secret-key` |
| .env.server（全キーまとめ） | `nextjs-fastapi-clerk-stripe/.env.server` (gitignored) |

## Stripe リソース (sandbox)

| リソース | ID |
|----------|-----|
| Pro Product | prod_UKOHKWIcjCXj12 |
| Pro Price (¥980/月) | price_1TLjWBCbRcSfD9CU2Ar12u6r |
| Enterprise Product | prod_UKOIC9FTKR9PJv |
| Enterprise Price (¥4,980/月) | price_1TLjWkCbRcSfD9CUaDpqU0qL |
| Webhook endpoint | we_1TLkDXCbRcSfD9CUdhzO8OKH |
| Webhook URL | http://160.251.237.88:8000/api/webhooks/stripe |

## Clerk リソース (development)

| リソース | 値 |
|----------|-----|
| Instance ID | ins_358hwkCp10ec9XJ8SZLlpIDRtHI |
| ドメイン | maximum-bird-92.clerk.accounts.dev |
| JWKS URL | https://maximum-bird-92.clerk.accounts.dev/.well-known/jwks.json |
| Webhook endpoint ID | ep_3CIvWOqn9eGCSJPcLRDUqjQbGsU |
| Webhook URL | http://160.251.237.88:8000/api/webhooks/clerk |
| Svix App ID | app_3CIsMsMC4j5qsMl8hkwDbjoW7qc |
| Svix region | eu |

## .env.server の再構築方法

別のマシンで `.env.server` を再作成する場合:

```bash
# Clerk keys を読む
cat ~/.config/planitai/clerk/keys
# → NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
# → CLERK_SECRET_KEY=sk_test_xxx

# Stripe key を読む
cat ~/.config/planitai/stripe/secret-key
# → sk_test_xxx

# .env.server を作成（Webhook secretは上記テーブル参照）
cat > nextjs-fastapi-clerk-stripe/.env.server << 'EOF'
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<Clerkから>
CLERK_SECRET_KEY=<Clerkから>
CLERK_WEBHOOK_SECRET=whsec_frC6dMLSsCHFPH+XVvhC3g+24OPSBRsB
CLERK_JWKS_URL=https://maximum-bird-92.clerk.accounts.dev/.well-known/jwks.json
STRIPE_SECRET_KEY=<Stripeから>
STRIPE_WEBHOOK_SECRET=whsec_EJDLOiSRaZxMPbMQkCRCjjFbJSCqfuOS
STRIPE_PRO_PRICE_ID=price_1TLjWBCbRcSfD9CU2Ar12u6r
STRIPE_ENTERPRISE_PRICE_ID=price_1TLjWkCbRcSfD9CUaDpqU0qL
EOF
```

## Clerk v7 + Next.js 16 の重要な注意点

1. **proxy.ts は named export `proxy` を使う** — default export だと middleware-manifest が空になる
2. **HTTP 環境では Clerk のサーバーサイド認証が動かない** — `crypto.subtle` がないため。クライアントコンポーネント (`useAuth`) を使う
3. **Turbopack は無効にする** — `NEXT_DISABLE_TURBOPACK=1 next build`
4. **`SignedIn`/`SignedOut` → `Show when="signed-in"`** (Clerk v7)
5. **shadcn/ui v4: `asChild` → `render` prop**
6. **Webhook は FastAPI に直接届ける** (ポート 8000) — Next.js rewrite 経由だと署名検証が壊れる

詳細は `docs/blogs/nextjs-fastapi-clerk-stripe.md` に9つのハマりポイントとして記録済み。

## Clerk/Stripe をダッシュボードなしでAPI設定する方法

`docs/blogs/nextjs-fastapi-clerk-stripe.md` の「事前準備」セクションに完全なコマンド例あり。

要点:
- **Stripe**: 通常のREST API (`curl -u "$KEY:"`)
- **Clerk Webhook**: Svix API 経由（ワンタイムトークン → APIトークン交換 → エンドポイント作成）
- **Clerk インスタンス設定**: `PATCH /v1/instance` で `allowed_origins`, `home_url` 等を設定

## PR と Issues

| 種別 | リンク | 内容 |
|------|--------|------|
| PR | crowdy/conoha-cli-app-samples#16 | このサンプル全体 |
| Issue | crowdy/conoha-cli#82 | app deploy で .env.server を build args にも渡す |
| Issue | crowdy/conoha-cli#83 | server create の --no-input / --yes の混乱 |
| Issue | crowdy/conoha-cli#84 | app deploy で .dockerignore を尊重する |

## gh コマンドのアカウント切り替え

```bash
# crowdy アカウントに切り替え（push/PR 作成時）
gh auth switch --user crowdy

# 元に戻す
gh auth switch --user t-kim-planitai
```

## 別のマシンで作業を続ける場合のセットアップ

### 1. 前提ツールのインストール

- [conoha-cli](https://github.com/crowdy/conoha-cli) — `conoha auth login` で認証
- [gh](https://cli.github.com/) — `gh auth login` で認証（crowdy アカウント）
- SSH キー — ConoHa VPS への接続用。`conoha keypair list` で確認し、秘密鍵をローカルに配置

### 2. リポジトリのクローンとブランチ切替

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples
git checkout feat/nextjs-fastapi-clerk-stripe
```

### 3. API キーの配置

以下のファイルを手動で作成する必要がある（セキュリティのためリポジトリには含まれていない）:

```bash
# Clerk キー
mkdir -p ~/.config/planitai/clerk
cat > ~/.config/planitai/clerk/keys << 'EOF'
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
EOF

# Stripe キー
mkdir -p ~/.config/planitai/stripe
echo "sk_test_xxxxx" > ~/.config/planitai/stripe/secret-key
```

実際のキー値は Clerk Dashboard (API Keys) と Stripe Dashboard (API Keys) から取得する。

### 4. .env.server の再作成

本ファイルの「.env.server の再構築方法」セクションを参照。Webhook secret はこのファイルに記載済み。

### 5. SSH 接続の確認

```bash
# ConoHa サーバーに接続できるか確認
ssh -i <秘密鍵パス> root@160.251.237.88 "docker compose -f /opt/conoha/nextjs-fastapi-clerk-stripe/compose.yml ps"
```

### 6. デプロイ・ログ確認

```bash
cd nextjs-fastapi-clerk-stripe

# 再デプロイ
conoha app deploy saas-demo --app-name nextjs-fastapi-clerk-stripe

# ログ確認
conoha app logs saas-demo --app-name nextjs-fastapi-clerk-stripe --follow

# コンテナ状態
conoha app status saas-demo --app-name nextjs-fastapi-clerk-stripe
```

### このマシンにしかないもの一覧

| 項目 | パス | 再取得方法 |
|------|------|-----------|
| Clerk API キー | `~/.config/planitai/clerk/keys` | Clerk Dashboard → API Keys |
| Stripe シークレットキー | `~/.config/planitai/stripe/secret-key` | Stripe Dashboard → API Keys |
| SSH 秘密鍵 | `~/.ssh/conoha_tkim-cli-test-key` | ConoHa キーペア再作成、または既存キーを転送 |
| .env.server | `nextjs-fastapi-clerk-stripe/.env.server` | 本ファイルの再構築手順で作成 |
| gh 認証トークン | `~/.config/gh/hosts.yml` | `gh auth login` で再認証 |
| conoha-cli 認証 | conoha-cli 設定ファイル | `conoha auth login` で再認証 |
