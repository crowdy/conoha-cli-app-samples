---
title: conoha-cliでQuickwit + OpenTelemetry + GrafanaのObservabilityスタックをワンコマンドデプロイ
tags: Quickwit opentelemetry Conoha conoha-cli Docker
author: crowdy
slide: false
---
## はじめに

ログやトレースの収集・検索基盤を自前で持ちたいけど、設定が複雑で二の足を踏んでいる方は多いのではないでしょうか。

この記事では、クラウドネイティブな検索エンジン **Quickwit** と、テレメトリ収集の標準規格 **OpenTelemetry**、可視化ツール **Grafana** を組み合わせたObservabilityスタックを、ConoHa VPS3 上にワンコマンドでデプロイする方法を紹介します。

デプロイには [conoha-cli](https://github.com/crowdy/conoha-cli) を使います。サーバー作成からアプリ起動まで、手元のターミナルだけで完結します。

---

## 使用するスタック

| コンポーネント | 役割 |
|---|---|
| **Quickwit** | ログ・トレースの保存と全文検索 |
| **OpenTelemetry Collector** | アプリからテレメトリを受け取りQuickwitへ転送 |
| **Grafana** | ダッシュボード・可視化 |

### アーキテクチャ

```
アプリケーション
  ↓ OTLP (gRPC :4317 / HTTP :4318)
OpenTelemetry Collector
  ↓ OTLP/HTTP
Quickwit (:7280)  ←→  Grafana (:3000)
```

アプリケーションのOTLPエンドポイントをCollectorに向けるだけで、ログとトレースが自動的にQuickwitに蓄積されます。Quickwitは最初のOTLPリクエスト受信時に `otel-logs-v0_7` と `otel-traces-v0_7` インデックスを自動作成するため、事前のインデックス定義は不要です。

---

## conoha-cli とは

[conoha-cli](https://github.com/crowdy/conoha-cli) は、ConoHa VPS3 をターミナルから操作するためのCLIツールです。

### 主な機能

- **サーバー管理**: VPSの作成・削除・一覧表示
- **app deploy**: `compose.yml` があるディレクトリをVPSにデプロイ
- **app logs**: コンテナログのリアルタイム表示
- **app status**: コンテナの稼働状態確認
- **環境変数管理**: `app env set` でセキュアに環境変数を注入

`app deploy` コマンドは内部でDockerとDocker Composeを自動セットアップし、ディレクトリをgit push形式でVPSへ転送してコンテナを起動します。SSHキーさえ設定すれば、コマンド1本でデプロイが完了します。

---

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み（`conoha keypair create` で作成可能）

---

## ファイル構成

```
quickwit-otel/
├── compose.yml
├── otel-collector-config.yaml
└── README.md
```

### compose.yml

```yaml
services:
  quickwit:
    image: quickwit/quickwit:latest
    ports:
      - "7280:7280"
      - "7281:7281"
    environment:
      - QW_ENABLE_OTLP_ENDPOINT=true
    volumes:
      - quickwit_data:/quickwit/qwdata
    command: run
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7280/health/livez"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4317:4317"
      - "4318:4318"
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
    depends_on:
      quickwit:
        condition: service_healthy

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    volumes:
      - grafana_data:/var/lib/grafana
    depends_on:
      quickwit:
        condition: service_healthy

volumes:
  quickwit_data:
  grafana_data:
```

`QW_ENABLE_OTLP_ENDPOINT=true` を設定することで、QuickwitのOTLPエンドポイント（`/otlp`）が有効になります。healthcheckにより、QuickwitがReadyになってからCollectorとGrafanaが起動する順序制御も行っています。

### otel-collector-config.yaml

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp/quickwit:
    endpoint: http://quickwit:7280/otlp
    tls:
      insecure: true

service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp/quickwit]
    traces:
      receivers: [otlp]
      exporters: [otlphttp/quickwit]
```

受信したログとトレースをそれぞれQuickwitのOTLPエンドポイントへ転送するシンプルな設定です。

---

## デプロイ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/crowdy/conoha-cli-app-samples.git
cd conoha-cli-app-samples/quickwit-otel
```

### 2. サーバー作成

```bash
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
```

### 3. アプリ初期化

```bash
conoha app init myserver --app-name quickwit-otel
```

実行すると以下のような出力が得られます。

```
Initializing app "quickwit-otel" on vm-18268c66-ae (133.88.116.147)...
==> Installing Docker...
==> Installing Docker Compose plugin...
==> Installing git...
==> Creating directories...
Initialized empty Git repository in /opt/conoha/quickwit-otel.git/
==> Installing post-receive hook...
==> Done!

App "quickwit-otel" initialized on vm-18268c66-ae (133.88.116.147).
```

`app init` は初回のみ実行します。Dockerのインストールからgitリポジトリの初期化まで、すべて自動で行われます。

### 4. デプロイ

```bash
conoha app deploy myserver --app-name quickwit-otel
```

デプロイ時はイメージのpullからコンテナ起動まで進捗がリアルタイムで表示されます。

```
Archiving current directory...
Uploading to vm-18268c66-ae (133.88.116.147)...
Building and starting containers...
 Image quickwit/quickwit:latest Pulling
 Image otel/opentelemetry-collector-contrib:latest Pulling
 Image grafana/grafana:latest Pulling
 ...（各レイヤーのダウンロード進捗）...
 Container quickwit-otel-quickwit-1 Started
 Container quickwit-otel-quickwit-1 Waiting
 Container quickwit-otel-quickwit-1 Healthy
 Container quickwit-otel-otel-collector-1 Started
 Container quickwit-otel-grafana-1 Started
NAME                             IMAGE                                         STATUS
quickwit-otel-grafana-1          grafana/grafana:latest                        Up Less than a second
quickwit-otel-otel-collector-1   otel/opentelemetry-collector-contrib:latest   Up About a minute
quickwit-otel-quickwit-1         quickwit/quickwit:latest                      Up 2 minutes (healthy)
Deploy complete.
```

healthcheckにより、Quickwitが完全にReadyになるまでCollectorとGrafanaの起動を待機していることが「Waiting → Healthy」の遷移から確認できます。

### 5. コンテナ状態の確認

```bash
conoha app status myserver --app-name quickwit-otel
```

```
NAME                             IMAGE                                         PORTS
quickwit-otel-grafana-1          grafana/grafana:latest                        0.0.0.0:3000->3000/tcp
quickwit-otel-otel-collector-1   otel/opentelemetry-collector-contrib:latest   0.0.0.0:4317-4318->4317-4318/tcp
quickwit-otel-quickwit-1         quickwit/quickwit:latest                      0.0.0.0:7280-7281->7280-7281/tcp
```

---

## 動作確認

### Quickwit Web UI

ブラウザで `http://<サーバーIP>:7280` を開くと、Quickwitの管理UIが表示されます。初期状態では `otel-logs-v0_7` と `otel-traces-v0_7` の2つのインデックスが自動作成されています。

### テストログの送信

OTLPのHTTPエンドポイントにcurlでログを送信してみます。

```bash
curl -X POST http://<サーバーIP>:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [{
          "key": "service.name",
          "value": {"stringValue": "my-service"}
        }]
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

レスポンス例：

```json
{
  "hits": [{
    "body": "Hello from OpenTelemetry!",
    "severity_text": "INFO",
    "service_name": "my-service",
    "timestamp_nanos": 1700000000000000000
  }],
  "num_hits": 1,
  "elapsed_time_micros": 5123
}
```

### ログの確認

```bash
conoha app logs myserver --app-name quickwit-otel
```

Quickwitの起動ログには、OTLPエンドポイントの有効化、インデックスの自動作成、各サービスの起動完了が出力されます。

```
quickwit-1  | INFO quickwit_config: enable_otlp_endpoint: true
quickwit-1  | INFO quickwit_serve: REST server is ready
quickwit-1  | INFO quickwit_serve: gRPC server is ready
otel-collector-1  | info Starting GRPC server endpoint=[::]:4317
otel-collector-1  | info Starting HTTP server endpoint=[::]:4318
otel-collector-1  | info Everything is ready. Begin running and processing data.
```

---

## アプリからの接続方法

既存のアプリにOTLPエンドポイントを設定するだけで、ログ・トレースが自動収集されます。

### Python (opentelemetry-sdk)

```python
from opentelemetry.sdk._logs import LoggerProvider
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

exporter = OTLPLogExporter(endpoint="http://<サーバーIP>:4318/v1/logs")
```

### Go

```go
exporter, _ := otlploghttp.New(ctx,
    otlploghttp.WithEndpoint("<サーバーIP>:4318"),
    otlploghttp.WithInsecure(),
)
```

### 環境変数で設定（言語非依存）

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://<サーバーIP>:4318
export OTEL_SERVICE_NAME=my-service
```

OpenTelemetry SDKを使っているアプリであれば、環境変数を設定するだけでログ・トレースが収集されます。

---

## カスタマイズのヒント

### otel-collector-config.yaml でフィルタリング

```yaml
processors:
  filter/errors_only:
    logs:
      log_record:
        - 'severity_number < SEVERITY_NUMBER_ERROR'

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [filter/errors_only]
      exporters: [otlphttp/quickwit]
```

ERRORレベル以上のログのみをQuickwitに保存する例です。

### 本番環境での注意点

- Grafanaの匿名アクセスを無効化する（`GF_AUTH_ANONYMOUS_ENABLED=false`）
- Quickwitのデータ量が増えた場合は g2l-t-4（4GB）フレーバーを推奨
- OTLPの認証が必要な場合はCollectorに `bearertokenauth` エクステンションを追加

---

## まとめ

conoha-cli の `app init` → `app deploy` の2コマンドで、Quickwit + OpenTelemetry Collector + GrafanaのObservabilityスタックをConoHa VPS3上に構築できました。

| アクセス先 | URL |
|---|---|
| Quickwit Web UI | `http://<IP>:7280` |
| Grafana | `http://<IP>:3000` |
| OTLP gRPC | `<IP>:4317` |
| OTLP HTTP | `<IP>:4318` |

サンプルのソースコードは以下で公開しています。

https://github.com/crowdy/conoha-cli-app-samples/tree/main/quickwit-otel

他にもWordPress、Rails、Gitea、Ollama、OAuth2サーバーなど20種類以上のサンプルが揃っていますので、ぜひ試してみてください。

