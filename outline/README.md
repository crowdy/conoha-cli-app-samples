# outline

Notion 代替のセルフホスティングチーム Wiki・ナレッジベース。Markdown エディタと豊富なコラボレーション機能を備えています。

## 構成

- [Outline](https://www.getoutline.com/) v0.82 — Wiki / ナレッジベース
- PostgreSQL 16 — データベース
- Redis 7 — キャッシュ・リアルタイム同期
- ポート: 3000（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- SSO プロバイダー（Outline はログインに SSO が必須: Slack、Google、OIDC など）

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name outline

# 環境変数を設定（SSO 設定は必須）
conoha app env set myserver --app-name outline \
  SECRET_KEY=$(openssl rand -hex 32) \
  UTILS_SECRET=$(openssl rand -hex 32) \
  DB_PASSWORD=your-secure-password \
  URL=http://your-server-ip:3000 \
  SLACK_CLIENT_ID=your-slack-client-id \
  SLACK_CLIENT_SECRET=your-slack-client-secret

# デプロイ
conoha app deploy myserver --app-name outline
```

## 動作確認

ブラウザで `http://<サーバーIP>:3000` にアクセスし、SSO でログインします。

## カスタマイズ

- SSO プロバイダー: Slack、Google、Azure AD、OIDC を環境変数で設定
- Slack 連携で `/outline search <query>` コマンドが利用可能
- API で外部ツールとの連携やコンテンツ同期が可能
- S3 互換ストレージへのファイル保存も設定可能
- 本番環境では `SECRET_KEY`、`UTILS_SECRET`、`DB_PASSWORD` を必ず変更してください
