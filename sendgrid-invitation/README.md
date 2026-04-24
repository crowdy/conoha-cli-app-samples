# SendGrid 招待メール

組織の管理者がメンバー候補に招待メールを送るシンプルな Web アプリ。

## 構成

- **Next.js 15** — 招待フォーム UI（accessory、内部ポート 3000）
- **FastAPI** — SendGrid メール送信 API（accessory、内部ポート 8000）
- **nginx** — Basic Auth 付きリバースプロキシ（**proxy 公開**、ポート 80）

> **note**: nginx が conoha-proxy 公開対象の `web` サービス、frontend と backend は
> accessory です。つまり **blue/green スワップは nginx だけが対象** で、frontend や
> backend のコード更新で `conoha app deploy` しても、新スロットは新しい nginx +
> 既存の frontend/backend を組み合わせます。frontend/backend に独立した
> blue/green が欲しい場合はそれぞれ別の `conoha.yml` プロジェクトとして
> conoha-proxy 直下に並べる構成に書き換えてください。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa アカウントと SSH キー
- SendGrid アカウントと API キー
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## セットアップ

### 1. SendGrid API キーの取得

1. [SendGrid](https://sendgrid.com/) でアカウントを作成
2. Settings > API Keys で API キーを作成（Mail Send 権限）
3. Sender Authentication で送信元メールアドレスを認証

### 2. Basic Auth ファイルの準備

```bash
# htpasswd がない場合: apt install apache2-utils
htpasswd -c nginx/.htpasswd admin
```

パスワードを入力してください。`.htpasswd` は compose で nginx にマウントされ、デプロイ tar に含まれて VPS にコピーされます。

## デプロイ

```bash
# 1. サーバー作成（2GB メモリ推奨）
conoha server create --name sendgrid --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com sendgrid

# 4. アプリ登録
conoha app init sendgrid

# 5. backend が読む環境変数を設定（このステップは必須 — SendGrid API
#    キーや送信元アドレスがないとメール送信が失敗します）
conoha app env set sendgrid \
  SENDGRID_API_KEY=SG.your-api-key-here \
  FROM_EMAIL=admin@example.com \
  FROM_NAME=あなたの組織名

# 6. デプロイ
conoha app deploy sendgrid
```

## 動作確認

1. `https://<あなたの FQDN>/` にアクセス（初回は Let's Encrypt 証明書発行に数十秒かかる場合があります）
2. Basic Auth のユーザー名・パスワードを入力
3. 招待フォームに宛先メール・名前・メッセージを入力
4. 「招待メールを送信」をクリック
5. 宛先に招待メールが届くことを確認
