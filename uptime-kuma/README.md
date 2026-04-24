# uptime-kuma

軽量なセルフホスティング監視ツール。Web サイトやサービスの稼働状態をリアルタイムで確認できます。

## 構成

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — 稼働監視ダッシュボード
- ポート: 3001（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. デプロイ
conoha app deploy myserver
```

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスし、初期管理者アカウントを作成します。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- ダッシュボードから監視対象（HTTP、TCP、DNS、Ping など）を追加
- 通知チャネル（Slack、Discord、LINE、メールなど）を設定可能
- proxy が HTTPS 終端を担うため、nginx の前段はもう不要です
