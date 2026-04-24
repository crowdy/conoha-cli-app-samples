# outline

Notion 代替のセルフホスティングチーム Wiki・ナレッジベース。Markdown エディタと豊富なコラボレーション機能を備えています。

## 構成

- [Outline](https://www.getoutline.com/) v0.82 — Wiki / ナレッジベース
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・リアルタイム同期
- [Dex](https://dexidp.io/) v2.39 — OIDC プロバイダー（SSO 認証用）
- ポート: 3000（Web UI）、5556（Dex OIDC）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — `URL` は Outline が生成する
#    asset URL の基準値として使われるため公開 FQDN に揃える）
conoha app env set myserver \
  SECRET_KEY=$(openssl rand -hex 32) \
  UTILS_SECRET=$(openssl rand -hex 32) \
  DB_PASSWORD=$(openssl rand -base64 32) \
  URL=https://outline.example.com

# 6. デプロイ
conoha app deploy myserver
```

## ログイン

> ⚠ **既知の制限**: デフォルトの Dex OIDC flow はこの layout では動作しません — 下述「[既知の制限: ブラウザ OIDC ログイン](#既知の制限-ブラウザ-oidc-ログイン)」を参照。

暫定では Outline のローカルアカウントまたは Magic Link (email) 認証を使ってください。Magic Link は compose に SMTP 環境変数を追加することで有効化できます（`SMTP_HOST` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM_EMAIL`）。

## 既知の制限: ブラウザ OIDC ログイン

`dex-config.yml` と compose にある `dex` サービスは **この layout では browser OIDC フローが動作しません**。原因は gitea サンプルと同じで、Dex の issuer URL (`http://<DEX_ISSUER_HOST>:5556/dex`) に browser が到達できないためです。

Gitea / Outline どちらも同じ問題を抱えており、subdomain 分離による正式対応を future batch で予定しています。当面は:

1. **Outline のローカルアカウント + email magic link** を使う（要 SMTP 設定）
2. **外部の OIDC プロバイダー** に切り替える（Google / GitHub / Auth0 等） — compose の `OIDC_*` 環境変数をそれぞれのプロバイダーに合わせて設定
3. **Dex を別 conoha.yml プロジェクトに切り出す**（`dex.example.com` サブドメイン）

## カスタマイズ

### Dex ユーザー・プロバイダーの変更

`dex-config.yml` を編集して静的ユーザーの追加・変更や、外部 IdP（LDAP、GitHub、Google 等）との連携が可能です。パスワードハッシュは以下で生成できます：

```bash
htpasswd -bnBC 10 "" 'your-password' | tr -d ':'
```

### Outline 設定

- S3 互換ストレージへのファイル保存: `FILE_STORAGE=s3` + S3 関連環境変数
- 本番環境では `SECRET_KEY`、`UTILS_SECRET`、`DB_PASSWORD` を必ず変更してください
- Dex を使わず Slack / Google / Azure AD で直接 SSO する場合は、compose.yml の OIDC 環境変数を各プロバイダーの設定に置き換えてください
