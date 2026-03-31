# wordpress-mysql

WordPress と MySQL の公式 Docker イメージを使ったサンプルです。Dockerfile 不要で、`compose.yml` だけでデプロイできます。

## 構成

- WordPress (公式イメージ)
- MySQL 8.0 (公式イメージ)
- ポート: 80

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name wordpress

# 環境変数を設定（パスワードを変更してください）
conoha app env set myserver --app-name wordpress \
  MYSQL_ROOT_PASSWORD=your_root_password \
  MYSQL_PASSWORD=your_wp_password

# デプロイ
conoha app deploy myserver --app-name wordpress
```

## 動作確認

ブラウザで `http://<サーバーIP>` にアクセスすると WordPress のセットアップ画面が表示されます。

## カスタマイズ

- テーマやプラグインは WordPress 管理画面からインストール
- 本番環境では必ず `conoha app env set` でパスワードを変更してください
- HTTPS が必要な場合はリバースプロキシ（nginx）を追加
