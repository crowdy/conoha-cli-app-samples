# prometheus-grafana

メトリクス収集・可視化の業界標準スタック。サーバーの CPU、メモリ、ディスクなどをリアルタイムで監視できます。

## 構成

- [Prometheus](https://prometheus.io/) v3.3 — メトリクス収集・保存（内部）
- [Grafana](https://grafana.com/) v11.6 — ダッシュボード・可視化（公開）
- [Node Exporter](https://github.com/prometheus/node_exporter) v1.9 — ホストメトリクス（内部）
- Proxy 公開ポート: 3000（Grafana のみ）

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

# 5. Grafana 管理者パスワードを変更（このステップは必須 — compose.yml の
#    デフォルト値 admin/admin のままデプロイすると誰でもログイン可能）
conoha app env set myserver GF_ADMIN_PASSWORD=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

`prometheus` と `node-exporter` は accessory として宣言されているため、blue/green 切替時も再起動されません。Grafana は内部ネットワーク経由で `prometheus:9090` を data source として参照するため、Prometheus UI を外部公開する必要はありません。

## 動作確認

1. Grafana: `https://<あなたの FQDN>` → `admin` + step 5 で設定したパスワードでログイン（初回は Let's Encrypt 証明書発行に数十秒かかる場合があります）
2. Grafana で Data Source に `http://prometheus:9090` を追加（コンテナ間の内部 DNS）
3. Dashboard ID `1860`（Node Exporter Full）をインポート

Prometheus UI を直接確認したい場合は、Grafana コンテナの Explore を使うか、SSH 経由で `docker exec -it conoha-app-<slot>-prometheus-1 wget -qO- http://localhost:9090/api/v1/...` のように叩けます。

## カスタマイズ

- `prometheus.yml` にスクレイプ対象を追加して他のサービスも監視可能
- Grafana のアラート機能で Slack・メール通知を設定
- 保持期間は `--storage.tsdb.retention.time` で調整（デフォルト 15 日）
- 本番環境では `GF_ADMIN_PASSWORD` を必ず変更してください
