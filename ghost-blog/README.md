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

# 5. 環境変数を設定（このステップは必須 —
#    - パスワードは compose.yml のデフォルト値が公開リポジトリに記載されているため
#    - GHOST_URL はこの値が Ghost の投稿・画像 URL 生成に使われるため本番 FQDN を指定）
conoha app env set myserver \
  MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32) \
  GHOST_DB_PASSWORD=$(openssl rand -base64 32) \
  GHOST_URL=https://<あなたの FQDN>

# 6. デプロイ
conoha app deploy myserver
```

`db` は accessory として宣言されているため、blue/green 切替時も MySQL は再起動されません。

## 動作確認

- ブログ: `https://<あなたの FQDN>`
- 管理画面: `https://<あなたの FQDN>/ghost/`

初回アクセス時に管理者アカウントのセットアップが行われます。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

## カスタマイズ

- テーマは Ghost 管理画面からアップロード
- `GHOST_URL` を本番 FQDN に設定し忘れると記事リンクや画像 URL が壊れます（step 5 参照）
- HTTPS は conoha-proxy が Let's Encrypt で自動終端します（別途 nginx 不要）
