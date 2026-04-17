# SendGrid 招待メール

組織の管理者がメンバー候補に招待メールを送るシンプルな Web アプリ。

## 構成

- **Next.js 15** — 招待フォーム UI（ポート 3000）
- **FastAPI** — SendGrid メール送信 API（ポート 8000）
- **nginx** — Basic Auth 付きリバースプロキシ（ポート 80）

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa アカウントと SSH キー
- SendGrid アカウントと API キー

## セットアップ

### 1. SendGrid API キーの取得

1. [SendGrid](https://sendgrid.com/) でアカウントを作成
2. Settings > API Keys で API キーを作成（Mail Send 権限）
3. Sender Authentication で送信元メールアドレスを認証

### 2. 環境変数の設定

\`\`\`bash
cp .env.server.example .env.server
\`\`\`

\`.env.server\` を編集:

\`\`\`
SENDGRID_API_KEY=SG.your-api-key-here
FROM_EMAIL=admin@example.com
FROM_NAME=あなたの組織名
\`\`\`

### 3. Basic Auth の設定

\`\`\`bash
# htpasswd がない場合: apt install apache2-utils
htpasswd -c nginx/.htpasswd admin
\`\`\`

パスワードを入力してください。

## デプロイ

\`\`\`bash
# サーバー作成（2GB メモリ推奨）
conoha-cli server create --name sendgrid-invitation --image ubuntu-24.04 --flavor g2l-t-c2m2

# アプリをデプロイ
conoha-cli app deploy --name sendgrid-invitation --path ./sendgrid-invitation
\`\`\`

## 動作確認

1. \`http://<サーバーIP>/\` にアクセス
2. Basic Auth のユーザー名・パスワードを入力
3. 招待フォームに宛先メール・名前・メッセージを入力
4. 「招待メールを送信」をクリック
5. 宛先に招待メールが届くことを確認
