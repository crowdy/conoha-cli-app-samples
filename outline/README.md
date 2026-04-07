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

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name outline

# dex-config.yml のプレースホルダーを実際の IP に置換
sed -i 's/YOUR_SERVER_IP/<サーバーIP>/g' dex-config.yml

# 環境変数を設定
conoha app env set myserver --app-name outline \
  SECRET_KEY=$(openssl rand -hex 32) \
  UTILS_SECRET=$(openssl rand -hex 32) \
  DB_PASSWORD=your-secure-password \
  URL=http://<サーバーIP>:3000 \
  OIDC_AUTH_URI=http://<サーバーIP>:5556/dex/auth

# デプロイ
conoha app deploy myserver --app-name outline
```

## ログイン

デフォルトでは Dex に静的ユーザーが設定されています：

- Email: `admin@example.com`
- Password: `password`

ブラウザで `http://<サーバーIP>:3000` にアクセスし、「Dex Login」ボタンからログインします。

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
