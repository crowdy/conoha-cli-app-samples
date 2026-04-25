# quickwit-otel

Quickwit（クラウドネイティブ検索エンジン）と OpenTelemetry Collector、Grafana を
組み合わせたログ・トレース収集基盤のサンプルです。OTLP HTTP エンドポイントを
別サブドメインで公開し、外部の VPS / クラウド環境から HTTPS で
テレメトリを送信できるレイアウトに移行しました。

> **要件**: `conoha-cli >= v0.6.1` が必要です。`expose:` ブロックは v0.3.0 で
> 入りましたが、`blue_green: false`(本サンプルで otel-collector を 1 インスタンス
> 固定するために必要)が正しく proxy にルーティングされるのは v0.6.1 以降です
> ([conoha-cli#163](https://github.com/crowdy/conoha-cli/issues/163))。

## 技術スタック

| レイヤー | 技術 | 公開先 |
|---------|------|-------|
| ダッシュボード | Grafana | `quickwit-otel.example.com` (root web) |
| OTLP 受信 | OpenTelemetry Collector | `otel.example.com` (`expose:` ブロック、HTTP のみ) |
| ログ・トレース検索 | Quickwit | accessory(内部) |

## アーキテクチャ

```
外部エージェント ──┬─ HTTPS otel.example.com/v1/{traces,logs,metrics}
                   │              │
                   │              ▼
                   │    conoha-proxy ──→ otel-edge:4318 (caddy sidecar)
                   │                            │
                   │                            │ reverse_proxy
                   │                            ▼
                   │                   otel-collector:4318 (OTLP HTTP)
                   │                            │
                   │                            ▼ otlphttp exporter
                   │                       quickwit:7280 (internal)
                   │                            ▲
ブラウザ ─────────┴─ HTTPS quickwit-otel.example.com
                                  │
                                  ▼
                          conoha-proxy ──→ grafana:3000
                                                │ data source
                                                └─→ quickwit:7280 (internal)

VPS 内部のアプリは otel-collector:4317 (gRPC) / :4318 (HTTP) に
compose ネットワーク経由でも引き続き送信可能(otel-edge を経由しない)。
```

- **grafana**: ダッシュボード UI。`quickwit-otel.example.com` で公開
- **otel-edge**: 軽量 caddy サイドカー(`otel.example.com` → `:4318`)。
  conoha-proxy の deploy 時 `GET /` プローブを 200 で返しつつ、OTLP
  POST トラフィックを `otel-collector:4318` に透過 reverse-proxy
  する。詳細は下記「設定ファイル解説」参照
- **otel-collector**: OTLP 受信本体。compose ネットワーク内部のみ。
  外部からの OTLP HTTP は otel-edge 経由で届く。`blue_green: false`
  で 1 インスタンス固定(再 bind 中の in-flight バッチ消失を回避)
- **quickwit**: ログ・トレースのストレージ + 検索エンジン。accessory なので
  blue/green 切り替えに左右されず、データボリュームも 1 インスタンス分のみ
- OTLP gRPC (:4317) は compose ネットワーク内部のみ(後述の制限参照)

## ディレクトリ構成

```
quickwit-otel/
├── Caddyfile                      # otel-edge: GET / → 200, POST /v1/* → otel-collector
├── compose.yml                    # 4 サービス定義(grafana, otel-edge, otel-collector, quickwit)
├── conoha.yml                     # web(grafana) + expose(otel-edge) + accessories(otel-collector, quickwit)
├── otel-collector-config.yaml     # OTLP receivers → quickwit otlphttp exporter
└── README.md
```

## 設定ファイル解説

### conoha.yml

- `web:` — root の `quickwit-otel.example.com` に対応。`grafana` サービスの
  `:3000` を blue/green でルーティング。`health.path: /api/health`
- `expose:` — サブドメインに追加サービスを生やすブロック。ここでは
  `otel.example.com` → `otel-edge:4318` をマップ(otel-edge が GET / の
  プローブを 200 で受け止め、OTLP POST トラフィックを `otel-collector:4318`
  に透過 reverse-proxy する)。`blue_green: false` で 1 インスタンス固定
- `accessories:` — blue/green 対象外で 1 インスタンスだけ走らせるサービス。
  `otel-collector`(OTLP 受信本体)と `quickwit`(ログ・トレース
  ストレージ + 検索)

### compose.yml

- **quickwit**: Quickwit。OTLP インデックス機能を `QW_ENABLE_OTLP_ENDPOINT`
  で有効化。データは `quickwit_data` ボリュームに永続化
- **otel-collector**: OpenTelemetry Collector contrib イメージ。
  `otel-collector-config.yaml` をマウント。compose ネットワーク内部のみで
  動作し、外部からの OTLP HTTP は `otel-edge` 経由で届く。OTLP gRPC (:4317)
  も compose 内部のみ
- **otel-edge**: 軽量 caddy サイドカー。`otel.example.com` の HTTPS リクエストを
  受け、conoha-proxy の `GET /` プローブには 200 で応答しつつ、OTLP POST
  (`/v1/{traces,logs,metrics}`) はそのまま `otel-collector:4318` に
  reverse-proxy する。設定は後述の `Caddyfile` 参照
- **grafana**: Grafana。`GF_SECURITY_ADMIN_PASSWORD` は `environment:` に
  書かず `.env.server` から流す(`conoha app env set` の値が反映されるため)

### Caddyfile

`otel-edge` の最小設定。`GET /` を 200 で返し、それ以外は
`otel-collector:4318` に透過 reverse-proxy する。
conoha-proxy の deploy 時 probe(GET /)が OTLP HTTP receiver の 404 で
失敗するのを避けるための薄いラッパー。

### otel-collector-config.yaml

OTLP receiver(gRPC + HTTP)→ quickwit に otlphttp で転送するパイプライン
(logs / traces)。サンプリングやフィルタリングを足す場合はこのファイルを編集。

## 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `GF_SECURITY_ADMIN_PASSWORD` | **必須** | Grafana の admin パスワード。
                                         `conoha app env set` で設定する |
| `GF_SECURITY_ADMIN_USER` | `admin` | Grafana の admin ユーザー名 |
| `GF_AUTH_ANONYMOUS_ENABLED` | `false` | 匿名アクセスを許可するか |
| `GF_AUTH_ANONYMOUS_ORG_ROLE` | `Viewer` | 匿名ユーザーのロール |

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.6.1`
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開する **2 つの FQDN** の DNS A レコードがサーバー IP を指している:
  - root: `quickwit-otel.example.com`(Grafana UI)
  - subdomain: `otel.example.com`(OTLP HTTP 受信エンドポイント)

## デプロイ

```bash
# 1. サーバー作成(2GB 以上推奨、データ量が多い場合は g2l-t-4)
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の root FQDN / subdomain を自分の値に書き換える
#    - `hosts:` (root web) → 例: quickwit-otel.example.com
#    - `expose[].host` (otel サブドメイン) → 例: otel.example.com
#    ※ subdomain を `hosts:` にも書くと validation で reject されます

# 3. proxy を起動(サーバーごとに 1 回だけ)
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定(このステップは必須 — Grafana Admin パスワードを
#    設定しないと公開 FQDN から admin/admin の初期パスワードが残る危険あり)
conoha app env set myserver \
  GF_SECURITY_ADMIN_PASSWORD=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

### Grafana

`https://<あなたの root FQDN>` にアクセス(初回は Let's Encrypt 証明書発行に
数十秒)。ユーザー名 `admin` と step 5 で設定したパスワードでログイン。
[quickwit-quickwit-datasource](https://grafana.com/grafana/plugins/quickwit-quickwit-datasource/)
プラグインを入れて、URL `http://quickwit:7280` で data source を追加。

### OTLP HTTP 送信(外部から)

外部のホスト・コンテナ・Lambda 等から OTLP HTTP で送信:

```bash
# logs
curl -X POST https://otel.example.com/v1/logs \
  -H 'Content-Type: application/json' \
  -d '{"resourceLogs":[...]}'

# traces
curl -X POST https://otel.example.com/v1/traces \
  -H 'Content-Type: application/json' \
  -d '{"resourceSpans":[...]}'

# metrics
curl -X POST https://otel.example.com/v1/metrics \
  -H 'Content-Type: application/json' \
  -d '{"resourceMetrics":[...]}'
```

各種 SDK では `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com` と
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` を環境変数で渡せば、
SDK が `/v1/{traces,logs,metrics}` にルーティングします。

### OTLP 送信(VPS 内部から)

VPS 内の他コンテナからは compose ネットワーク経由で `otel-collector:4317`
(gRPC) または `otel-collector:4318`(HTTP)に直接送信できます。
HTTPS / 公開証明書が不要な分こちらが軽量です。

## 既知の制限: OTLP gRPC は外部公開していません

- **OTLP gRPC (:4317)** は `otel.example.com` 経由で公開していません。
  conoha-proxy は HTTP/1.1 リバースプロキシを前提としており、gRPC は
  HTTP/2 + ALPN を end-to-end で必要とします(かつ upstream 側で H2C を
  扱える必要あり)。proxy 側の gRPC サポートは別途 RFC として整理予定
  (将来の "proxy gRPC support" RFC で扱う、本サンプルでは未対応のまま
  据え置き)
- 当面、外部エージェントからは **OTLP HTTP (`/v1/*`)** を使ってください。
  ほとんどの SDK / Collector / Agent は HTTP exporter を選択可能です
- VPS 内部の同一 compose ネットワークからは引き続き
  `otel-collector:4317` で gRPC 送信できます

## カスタマイズ

- `otel-collector-config.yaml` を編集してフィルタリング・サンプリング・
  複数エクスポーター設定が可能です
- デフォルトは anonymous アクセス無効・admin 認証必須。社内で閲覧のみ
  許可したい場合は `conoha app env set` で
  `GF_AUTH_ANONYMOUS_ENABLED=true` `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer`
  を設定可能(公開 FQDN で Admin ロールを anonymous に与えるのは非推奨)
- データ量が多い場合は g2l-t-4(4GB)フレーバーを推奨します
