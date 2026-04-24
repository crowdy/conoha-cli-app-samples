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
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — compose.yml のデフォルト値は
#    公開リポジトリに記載されているため本番では必ず変更してください）
conoha app env set myserver \
  MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32) \
  MYSQL_PASSWORD=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

`db` は accessory として宣言されているため、blue/green 切替時も MySQL は再起動されません。

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスすると WordPress のセットアップ画面が表示されます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- テーマやプラグインは WordPress 管理画面からインストール
- 本番環境では必ず step 5 の `conoha app env set` でパスワードを変更してください
- HTTPS は conoha-proxy が Let's Encrypt で自動終端します（別途 nginx 不要）
