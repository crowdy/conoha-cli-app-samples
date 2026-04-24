# rails-mercari

Mercari 風の中古マーケットプレイスアプリです。商品の出品・購入と、Sidekiq による非同期通知を備えています。

## 構成

- Ruby 3.4 + Rails 8.1
- PostgreSQL 17
- Redis 7
- Sidekiq 7.3（非同期ジョブ）
- Nginx（リバースプロキシ）
- Dex（OIDC 認証プロバイダ）
- ポート: 80（Nginx）

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

# 5. 環境変数を設定（Rails / Dex が自己参照 URL を生成する基準値）
conoha app env set myserver \
  RAILS_HOST=rails-mercari.example.com \
  DEX_ISSUER_HOST=rails-mercari.example.com \
  DB_PASSWORD=$(openssl rand -base64 32) \
  SECRET_KEY_BASE=$(openssl rand -hex 64)

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

ブラウザで `https://<あなたの FQDN>` にアクセスします。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

> ⚠ **既知の制限**: デフォルトの Dex OIDC ログインはこの layout では動作しません — 下述「既知の制限」参照。当面は Rails のローカル認証を使ってください。

### テストユーザー（ローカル認証を利用）

| メールアドレス | パスワード | 役割 |
|---------------|-----------|------|
| seller@example.com | password | 出品者 |
| buyer@example.com | password | 購入者 |

### 操作手順

1. seller@example.com でログイン
2. 「出品する」から商品を登録
3. ログアウト → buyer@example.com でログイン
4. 商品の「購入する」ボタンをクリック
5. `conoha app logs myserver` で Sidekiq の通知ログを確認

## 既知の制限

### blue/green の適用範囲は nginx のみ

このサンプルでは **nginx のみが blue/green 対象** で、Rails `web` / `sidekiq` / `redis` / `dex` / `db` はすべて accessory です。`web` のコードを更新して `conoha app deploy` しても、新スロットでは nginx だけが再ビルドされ、inner `web` は旧コンテナが使われ続けます。

Rails 本体に独立した blue/green が欲しい場合、`web` と `sidekiq` を別 `conoha.yml` プロジェクト (`app.mercari.example.com`) に切り出す必要があります。future batch で対応検討中。

### Dex OIDC ログインは動かない

Dex の issuer URL (`http://<DEX_ISSUER_HOST>:5556/dex`) に browser が到達できないため、「Dex でログイン」フローは失敗します。回避策は gitea / outline と同じ:

1. Dex を別 `conoha.yml` プロジェクトに切り出す (`dex.mercari.example.com`)
2. Rails のローカル session 認証のみを使う（本 README の動作確認手順どおり）
3. 外部の OIDC プロバイダー（GitHub / Google 等）を Rails の OmniAuth に登録する

## カスタマイズ

- `app/controllers/` と `app/views/` を編集して機能を追加
- `db/migrate/` に新しいマイグレーションを追加してスキーマを変更
- 本番環境では `.env.server` で `SECRET_KEY_BASE`、`DB_PASSWORD` を管理
- Dex に外部 OIDC コネクタ（GitHub、Google 等）を追加可能
