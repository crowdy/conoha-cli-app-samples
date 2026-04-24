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
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（4GB 以上推奨、写真の量に応じてストレージも検討）
conoha server create --name myserver --flavor g2l-t-4 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — デフォルトの DB_PASSWORD は
#    公開リポジトリに記載されています）
conoha app env set myserver DB_PASSWORD=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

`immich-machine-learning`、`db` (pgvecto-rs)、`redis` は accessory として宣言されているため、blue/green 切替時も再起動されません — ML モデルキャッシュ、写真メタデータ、ジョブキューは deploy 越しに保持されます。

## 動作確認

1. ブラウザで `https://<あなたの FQDN>` にアクセス（初回は Let's Encrypt 証明書発行に数十秒かかる場合があります）
2. 初期管理者アカウントを作成
3. モバイルアプリ（iOS / Android）からサーバー URL を `https://<あなたの FQDN>` に設定してバックアップ開始

## カスタマイズ

- モバイルアプリで自動バックアップを設定（Wi-Fi のみ、外部ストレージなど）
- 顔認識・場所検索・スマートアルバム機能が利用可能
- 外部ストレージ（NFS、S3 互換）をマウントして写真保存先を変更可能
- 本番環境では `DB_PASSWORD` を必ず変更してください
