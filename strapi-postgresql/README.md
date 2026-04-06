# strapi-postgresql

API ファーストのヘッドレス CMS。コンテンツ API を GUI で定義し、Next.js や SvelteKit などのフロントエンドから利用できます。

## 構成

- [Strapi](https://strapi.io/) v4.25 — ヘッドレス CMS
- PostgreSQL 16 — データベース
- ポート: 1337（管理画面 + API）

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペアが設定済み

## デプロイ

```bash
# サーバー作成
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name strapi-postgresql

# 環境変数を設定
conoha app env set myserver --app-name strapi-postgresql \
  DB_PASSWORD=your-secure-password \
  APP_KEYS=key1,key2,key3,key4 \
  API_TOKEN_SALT=$(openssl rand -base64 16) \
  ADMIN_JWT_SECRET=$(openssl rand -base64 16) \
  JWT_SECRET=$(openssl rand -base64 16)

# デプロイ
conoha app deploy myserver --app-name strapi-postgresql
```

## 動作確認

1. `http://<サーバーIP>:1337/admin` で初期管理者アカウントを作成
2. Content-Type Builder でコンテンツタイプを定義
3. `http://<サーバーIP>:1337/api/<content-type>` で REST API にアクセス

## カスタマイズ

- GraphQL プラグインを有効にすると GraphQL API も利用可能
- メディアライブラリで画像・ファイルを管理
- Next.js や SvelteKit のフロントエンドと組み合わせてフルスタック構成に
- 本番環境では全てのシークレットキーを必ず変更してください
