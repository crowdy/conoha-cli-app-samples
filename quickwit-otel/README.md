# quickwit-otel

Quickwit（クラウドネイティブ検索エンジン）と OpenTelemetry Collector、Grafana を組み合わせたログ・トレース収集基盤のサンプルです。

## 構成

- Quickwit（ログ・トレース検索エンジン）
- OpenTelemetry Collector（テレメトリデータ収集・転送）
- Grafana（ダッシュボード・可視化）
- ポート: 7280（Quickwit UI + API）、4317（OTLP gRPC）、4318（OTLP HTTP）、3000（Grafana）

## アーキテクチャ

```
アプリ → OTel Collector (:4317/:4318) → Quickwit (:7280) ← Grafana (:3000)
```

アプリケーションの OTLP エンドポイントを OTel Collector に向けるだけで、ログとトレースが自動的に Quickwit に蓄積されます。

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（2GB以上推奨）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name quickwit-otel

# デプロイ
conoha app deploy myserver --app-name quickwit-otel
```

## 動作確認

- Quickwit Web UI: `http://<サーバーIP>:7280`
- Grafana: `http://<サーバーIP>:3000`

### テストログの送信

```bash
# OTLP HTTP でログを送信
curl -X POST http://<サーバーIP>:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [{"key": "service.name", "value": {"stringValue": "my-service"}}]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "1700000000000000000",
          "severityText": "INFO",
          "body": {"stringValue": "Hello from OpenTelemetry!"}
        }]
      }]
    }]
  }'
```

### Quickwit でログを検索

```bash
curl "http://<サーバーIP>:7280/api/v1/otel-logs-v0_7/search?query=*&max_hits=10"
```

## カスタマイズ

- アプリの OTLP エンドポイントを `http://<サーバーIP>:4317`（gRPC）または `http://<サーバーIP>:4318`（HTTP）に設定するだけでログ・トレースを収集できます
- Grafana で Quickwit データソースを追加する場合は、[quickwit-quickwit-datasource](https://grafana.com/grafana/plugins/quickwit-quickwit-datasource/) プラグインを手動でインストールしてください（URL: `http://quickwit:7280`）
- `otel-collector-config.yaml` を編集してフィルタリング・サンプリング・複数エクスポーター設定が可能です
- 本番環境では `GF_AUTH_ANONYMOUS_ENABLED=false` に設定し、認証を有効化してください
- データ量が多い場合は g2l-t-4（4GB）フレーバーを推奨します
