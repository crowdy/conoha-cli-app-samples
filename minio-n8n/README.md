# minio-n8n

MinIO（S3 互換オブジェクトストレージ）と n8n（ワークフロー自動化）を組み合わせたセルフホスティング基盤です。

## 構成

- n8n（ワークフロー自動化プラットフォーム） — proxy 経由で公開（5678）
- MinIO（S3 互換ストレージ） — accessory、内部ネットワーク経由で n8n が利用（9000 API、9001 コンソール）

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

# 5. 環境変数を設定（このステップは必須 — compose.yml のデフォルト値
#    minioadmin/admin は公開リポジトリに記載されています。
#    WEBHOOK_URL は n8n の webhook 機能で外部到達可能な URL を生成
#    するために公開 FQDN を指定）
#    `minio-n8n.example.com` は conoha.yml の `hosts:` に合わせて
#    自分の FQDN に置き換えてください。
conoha app env set myserver \
  MINIO_ROOT_USER=admin \
  MINIO_ROOT_PASSWORD=$(openssl rand -base64 32) \
  N8N_USER=admin \
  N8N_PASSWORD=$(openssl rand -base64 32) \
  WEBHOOK_URL=https://minio-n8n.example.com

# 6. デプロイ
conoha app deploy myserver
```

`minio` は accessory として宣言されているため、blue/green 切替時もバケットデータは保持されます。

## 動作確認

- n8n: `https://<あなたの FQDN>`（初回は Let's Encrypt 証明書発行に数十秒かかる場合があります）
- n8n 内部から MinIO を呼ぶ場合のエンドポイント: `http://minio:9000`（compose 内部 DNS）

### MinIO を直接操作したい場合

MinIO コンソール（9001）と API（9000）は **conoha-proxy 経由では公開されません**（proxy は 1 サービス・1 ポートのみフロント）。`expose:` のみで host-side binding も無いため、SSH トンネル（`-L 9001:localhost:9001`）ではホスト側の 9001 に何もバインドされておらず到達できません。

バケットを操作する場合は VPS に SSH ログイン後、MinIO コンテナ内の `mc` CLI を使ってください：

```bash
conoha server ssh myserver
# MinIO コンテナに入って mc で操作:
docker exec -it $(docker ps --filter label=com.docker.compose.service=minio --format '{{.Names}}') sh
# コンテナ内で:
mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc ls local
mc mb local/new-bucket
```

コンソール GUI が必要なユースケースでは、別 FQDN を `conoha.yml hosts:` に追加してコンソール専用エントリを立てる構成も可能ですが、本サンプルでは対応していません。

## カスタマイズ

- n8n で MinIO ノードを使い、ファイルアップロード/ダウンロードの自動化が可能
- MinIO は AWS S3 互換 API なので、既存の S3 ツールがそのまま使用可能
- n8n は 400 以上のサービスとの連携ノードを提供
