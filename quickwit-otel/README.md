# quickwit-otel

Quickwit（クラウドネイティブ検索エンジン）と OpenTelemetry Collector、Grafana を組み合わせたログ・トレース収集基盤のサンプルです。

## 構成

- Quickwit（ログ・トレース検索エンジン） — accessory（内部）
- OpenTelemetry Collector（テレメトリ収集・転送） — accessory（内部）
- Grafana（ダッシュボード・可視化） — **proxy 公開**
- proxy 公開ポート: 3000（Grafana のみ）
- 内部のみ: 7280/7281（Quickwit）、4317（OTLP gRPC）、4318（OTLP HTTP）

## アーキテクチャ

```
VPS 内のアプリ → otel-collector (:4317/:4318 internal) → quickwit (:7280 internal)
                                                              ▲
                                                              │ data source
                                       ブラウザ → proxy → grafana (:3000)
```

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（2GB以上推奨）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — Grafana Admin パスワードを
#    設定しないと公開 FQDN から anonymous アクセスが可能になる危険あり）
conoha app env set myserver \
  GF_SECURITY_ADMIN_PASSWORD=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

Grafana: `https://<あなたの FQDN>` にアクセス（初回は Let's Encrypt 証明書発行に数十秒かかります）。ユーザー名 `admin` と step 5 で設定したパスワードでログイン。[quickwit-quickwit-datasource](https://grafana.com/grafana/plugins/quickwit-quickwit-datasource/) プラグインを入れて、URL `http://quickwit:7280` で data source を追加。

### テレメトリ送信（VPS 内部から）

OTLP エンドポイントは proxy 経由では **公開されません**。同じ VPS 内のアプリケーションは compose ネットワーク経由で `otel-collector:4317` / `otel-collector:4318` に送信できます。

```bash
# 例: VPS に SSH してから同じ docker ネットワーク上のコンテナから送信
ssh root@<サーバー IP>
docker exec $(docker ps -q -f name=grafana) wget -O- --post-data='{...OTLP JSON...}' \
  --header 'Content-Type: application/json' \
  http://otel-collector:4318/v1/logs
```

## ⚠ 既知の制限: OTLP 外部受信

- **OTLP gRPC (4317)** は HTTP proxy を通過できません（gRPC = HTTP/2 ストリーミング、proxy は HTTP/1.1 リバプロ前提）
- **OTLP HTTP (4318)** と **Quickwit 直接 API (7280)** も同様に proxy 経由では公開できない

外部エージェント（別ホストの app、Lambda、モバイル端末など）から OTLP を送りたい場合、`otel-collector` を別 `conoha.yml` プロジェクトに切り出して `otel.example.com` サブドメインで proxy 経由に乗せる必要があります（gRPC は TLS + HTTP/2 ALPN を proxy が正しく扱える前提 — 未検証）。future batch で対応検討中。

## カスタマイズ

- `otel-collector-config.yaml` を編集してフィルタリング・サンプリング・複数エクスポーター設定が可能です
- デフォルトは anonymous アクセス無効・admin 認証必須。社内で閲覧のみ許可したい場合は `conoha app env set` で `GF_AUTH_ANONYMOUS_ENABLED=true` `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer` を設定可能（公開 FQDN で Admin ロールを anonymous に与えるのは非推奨）
- データ量が多い場合は g2l-t-4（4GB）フレーバーを推奨します
