# strapi-postgresql

API ファーストのヘッドレス CMS。コンテンツ API を GUI で定義し、Next.js や SvelteKit などのフロントエンドから利用できます。

## 構成

- [Strapi](https://strapi.io/) v4.25.9 — ヘッドレス CMS（Dockerfile ビルド）
- PostgreSQL 16 — データベース
- ポート: 1337（管理画面 + API）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

## デプロイ

```bash
# 1. サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 3. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定（このステップは必須 — スキップすると compose.yml の
#    デフォルト値 "change-me" のままデプロイされ、管理画面の JWT が
#    他サンプルと共有になります）
conoha app env set myserver \
  DB_PASSWORD=$(openssl rand -base64 32) \
  APP_KEYS=$(openssl rand -base64 32),$(openssl rand -base64 32),$(openssl rand -base64 32),$(openssl rand -base64 32) \
  API_TOKEN_SALT=$(openssl rand -base64 32) \
  ADMIN_JWT_SECRET=$(openssl rand -base64 32) \
  JWT_SECRET=$(openssl rand -base64 32) \
  TRANSFER_TOKEN_SALT=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

`db` は accessory として宣言されているため、blue/green 切替時も PostgreSQL は再起動されません。

## 動作確認

1. `https://<あなたの FQDN>/admin` で初期管理者アカウントを作成
2. Content-Type Builder でコンテンツタイプを定義
3. `https://<あなたの FQDN>/api/<content-type>` で REST API にアクセス
4. 初回は Let's Encrypt 証明書発行に数十秒かかる場合があります

## カスタマイズ

- GraphQL プラグインを有効にすると GraphQL API も利用可能
- メディアライブラリで画像・ファイルを管理
- Next.js や SvelteKit のフロントエンドと組み合わせてフルスタック構成に
- 本番環境では全てのシークレットキーを必ず変更してください
