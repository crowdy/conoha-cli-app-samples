# uptime-kuma

軽量なセルフホスティング監視ツール。Web サイトやサービスの稼働状態をリアルタイムで確認できます。

## 構成

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) — 稼働監視ダッシュボード
- ポート: 3001（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# アプリ初期化・デプロイ
conoha app init myserver --app-name uptime-kuma
conoha app deploy myserver --app-name uptime-kuma
```

## 動作確認

ブラウザで `http://<サーバーIP>:3001` にアクセスし、初期管理者アカウントを作成します。

## カスタマイズ

- ダッシュボードから監視対象（HTTP、TCP、DNS、Ping など）を追加
- 通知チャネル（Slack、Discord、LINE、メールなど）を設定可能
- 本番環境では nginx リバースプロキシを前段に追加し HTTPS 化を推奨
