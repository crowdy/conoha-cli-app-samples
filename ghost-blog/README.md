# ghost-blog

Ghost と MySQL の公式 Docker イメージを使ったブログプラットフォームです。WordPress の代替として人気が高まっています。

## 構成

- Ghost 5（公式イメージ）
- MySQL 8.0（公式イメージ）
- ポート: 2368

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name ghost

# 環境変数を設定（パスワードを変更してください）
conoha app env set myserver --app-name ghost \
  MYSQL_ROOT_PASSWORD=your_root_password \
  GHOST_DB_PASSWORD=your_ghost_password

# デプロイ
conoha app deploy myserver --app-name ghost
```

## 動作確認

- ブログ: `http://<サーバーIP>:2368`
- 管理画面: `http://<サーバーIP>:2368/ghost/`

初回アクセス時に管理者アカウントのセットアップが行われます。

## カスタマイズ

- テーマは Ghost 管理画面からアップロード
- `compose.yml` の `url` 環境変数にドメインを設定
- HTTPS が必要な場合は nginx リバースプロキシを前段に追加
- 本番環境では必ず `.env.server` でパスワードを変更
