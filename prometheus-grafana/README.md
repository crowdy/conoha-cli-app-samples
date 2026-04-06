# prometheus-grafana

メトリクス収集・可視化の業界標準スタック。サーバーの CPU、メモリ、ディスクなどをリアルタイムで監視できます。

## 構成

- [Prometheus](https://prometheus.io/) v3.3 — メトリクス収集・保存
- [Grafana](https://grafana.com/) v11.6 — ダッシュボード・可視化
- [Node Exporter](https://github.com/prometheus/node_exporter) v1.9 — ホストメトリクス
- ポート: 9090（Prometheus）、3000（Grafana）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name prometheus-grafana

# （任意）Grafana 管理者パスワードを変更
conoha app env set myserver --app-name prometheus-grafana \
  GF_ADMIN_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name prometheus-grafana
```

## 動作確認

1. Prometheus: `http://<サーバーIP>:9090` → Status > Targets で node-exporter が UP
2. Grafana: `http://<サーバーIP>:3000` → admin / admin でログイン
3. Grafana で Data Source に `http://prometheus:9090` を追加
4. Dashboard ID `1860`（Node Exporter Full）をインポート

## カスタマイズ

- `prometheus.yml` にスクレイプ対象を追加して他のサービスも監視可能
- Grafana のアラート機能で Slack・メール通知を設定
- 保持期間は `--storage.tsdb.retention.time` で調整（デフォルト 15 日）
- 本番環境では `GF_ADMIN_PASSWORD` を必ず変更してください
