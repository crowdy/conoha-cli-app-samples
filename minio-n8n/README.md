# minio-n8n

MinIO（S3 互換オブジェクトストレージ）と n8n（ワークフロー自動化）を組み合わせたセルフホスティング基盤です。

## 構成

- MinIO（S3 互換ストレージ）
- n8n（ワークフロー自動化プラットフォーム）
- ポート: 9000（MinIO API）、9001（MinIO コンソール）、5678（n8n）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（2GB以上推奨）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name minio-n8n

# 環境変数を設定（パスワードを変更してください）
conoha app env set myserver --app-name minio-n8n \
  MINIO_ROOT_USER=your_minio_user \
  MINIO_ROOT_PASSWORD=your_minio_password \
  N8N_USER=your_n8n_user \
  N8N_PASSWORD=your_n8n_password

# デプロイ
conoha app deploy myserver --app-name minio-n8n
```

## 動作確認

- MinIO コンソール: `http://<サーバーIP>:9001`
- MinIO API: `http://<サーバーIP>:9000`
- n8n: `http://<サーバーIP>:5678`

## カスタマイズ

- n8n で MinIO ノードを使い、ファイルアップロード/ダウンロードの自動化が可能
- MinIO は AWS S3 互換 API なので、既存の S3 ツールがそのまま使用可能
- n8n は 400 以上のサービスとの連携ノードを提供
- 本番環境では必ず `.env.server` でパスワードを変更
