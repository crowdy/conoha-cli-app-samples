# immich

Google フォト代替のセルフホスティング写真・動画管理プラットフォーム。AI による自動分類・検索機能を備えています。

## 構成

- [Immich](https://immich.app/) v1.131 — 写真・動画管理（サーバー + ML）
- PostgreSQL 16（pgvecto.rs 拡張）— データベース + ベクトル検索
- Redis 7 — キャッシュ
- ポート: 2283（Web UI）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

```bash
# サーバー作成（4GB 以上推奨、写真の量に応じてストレージも検討）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name immich

# 環境変数を設定
conoha app env set myserver --app-name immich \
  DB_PASSWORD=your-secure-password

# デプロイ
conoha app deploy myserver --app-name immich
```

## 動作確認

1. ブラウザで `http://<サーバーIP>:2283` にアクセス
2. 初期管理者アカウントを作成
3. モバイルアプリ（iOS / Android）からサーバー URL を設定してバックアップ開始

## カスタマイズ

- モバイルアプリで自動バックアップを設定（Wi-Fi のみ、外部ストレージなど）
- 顔認識・場所検索・スマートアルバム機能が利用可能
- 外部ストレージ（NFS、S3 互換）をマウントして写真保存先を変更可能
- 本番環境では `DB_PASSWORD` を必ず変更してください
