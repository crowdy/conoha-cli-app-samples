# rails-mercari

Mercari 風の中古マーケットプレイスアプリです。商品の出品・購入と、Sidekiq による
非同期通知を備えています。Dex OIDC を別サブドメインで公開し、Rails `web` も
独立サブドメインで blue/green するレイアウトに移行しました。

> **要件**: `conoha-cli >= v0.6.1` が必要です。`expose:` ブロックは v0.3.0 で
> 入りましたが、`blue_green: false`(本サンプルで dex を accessories 側に
> 固定するために必要)が正しく proxy にルーティングされるのは v0.6.1 以降です
> ([conoha-cli#163](https://github.com/crowdy/conoha-cli/issues/163))。

## 構成

| レイヤー | 技術 | バージョン | 公開先 |
|---------|------|-----------|-------|
| ルート Web | Nginx | alpine | `rails-mercari.example.com` (root web, blue/green) |
| Rails アプリ | Rails | 8.1 | `app.example.com` (`expose:` ブロック, blue/green) |
| OIDC プロバイダー | Dex | v2.45.1 | `auth.example.com` (`expose:` ブロック) |
| データベース | PostgreSQL | 17 | accessory(永続化) |
| キャッシュ | Redis | 7 | accessory |
| ジョブワーカー | Sidekiq | 7.3 | accessory(非同期通知) |

## アーキテクチャ

```
ブラウザ ──┬─ HTTPS rails-mercari.example.com ─→ conoha-proxy ─→ nginx:80 ─┬─ web:3000
           │                                                                 └─ dex:5556 (legacy /dex/)
           ├─ HTTPS app.example.com           ─→ conoha-proxy ─→ web:3000  (Rails 直接, blue/green)
           └─ HTTPS auth.example.com          ─→ conoha-proxy ─→ dex:5556  (OIDC issuer)
                                                                          │
                                              internal compose net        ▼
                                                                       db:5432
                                                                       redis:6379
                                                                       sidekiq
```

- **nginx** (root web): 既存の root FQDN を維持。Rails と Dex を内部で集約して
  `/` と `/dex/` にルーティングする後方互換レイヤー
- **web** (Rails): `app.example.com` 経由で blue/green 公開。OIDC の `issuer` /
  `redirect_uri` は `auth.example.com` / `app.example.com` を使用
- **dex**: `auth.example.com` 経由で公開。ブラウザ discovery / redirect が HTTPS で
  完結する。`blue_green: false`(Postgres バックエンドのセッションが
  blue/green スロットで分散しないように 1 インスタンス固定)
- **db**: PostgreSQL 17。accessory なので blue/green 切り替え時も生き残る
- **redis** / **sidekiq**: 非同期ジョブ用。accessory(issue #54 §1.3 — worker は
  本パターンの対象外)

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.6.1`
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開する **3 つの FQDN** の DNS A レコードがサーバー IP を指している:
  - root: `rails-mercari.example.com`(nginx 経由のアプリ shell)
  - subdomain: `app.example.com`(Rails web 直接, blue/green)
  - subdomain: `auth.example.com`(Dex OIDC issuer)

## デプロイ

```bash
# 1. サーバー作成(まだない場合)
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の FQDN を自分の値に書き換える
#    - `hosts:` (root web) → 例: rails-mercari.example.com
#    - `expose[].host` (auth サブドメイン) → 例: auth.example.com
#    - `expose[].host` (app サブドメイン)  → 例: app.example.com
#    ※ subdomain を `hosts:` にも書くと validation で reject されます

# 3. proxy を起動(サーバーごとに 1 回だけ)
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定(このステップは必須 — DEX_ISSUER_HOST / RAILS_HOST は
#    必ず本番 FQDN にすること。OIDC redirect / issuer URL がここから組み立てられる)
conoha app env set myserver \
  DB_PASSWORD=$(openssl rand -base64 32) \
  SECRET_KEY_BASE=$(openssl rand -hex 64) \
  DEX_DB_PASSWORD=$(openssl rand -base64 32) \
  DEX_ISSUER_HOST=auth.example.com \
  RAILS_HOST=app.example.com \
  RAILS_OIDC_CLIENT_ID=mercari-app \
  RAILS_OIDC_CLIENT_SECRET=$(openssl rand -base64 32) \
  OIDC_CLIENT_SECRET=$(openssl rand -base64 32)

# 6. デプロイ
conoha app deploy myserver
```

> `RAILS_OIDC_CLIENT_SECRET` (Dex 側) と `OIDC_CLIENT_SECRET` (Rails 側) は
> 必ず同じ値を指定してください。`dex.yml` の `staticClients[].secret` と
> Rails OmniAuth の `client_options.secret` が一致しないと OIDC token 交換が
> 失敗します。

## 動作確認

### 1. コンテナの状態確認

```bash
conoha app status myserver
conoha app logs myserver
```

### 2. アプリへのアクセス

ブラウザで `https://<rails-mercari FQDN>` または `https://<app FQDN>` を開きます。
初回は Let's Encrypt 証明書発行に数十秒かかる場合があります(3 つの FQDN 分)。

### テストユーザー

| メールアドレス | パスワード | 役割 |
|---------------|-----------|------|
| seller@example.com | password | 出品者 |
| buyer@example.com | password | 購入者 |

### 3. Dex 経由の OIDC ログイン

1. ホーム画面で **Dex でログイン** ボタンをクリック
2. Dex のログイン画面(`auth.example.com`)で `staticPasswords` に定義した
   `seller@example.com` / `password` を入力
3. Rails(`app.example.com`)に戻り、`/auth/dex/callback` でセッション確立
4. 「出品する」から商品を登録
5. ログアウト → `buyer@example.com` で再ログイン → 商品の「購入する」
6. `conoha app logs myserver` で Sidekiq の通知ログを確認

> **重要**: `dex.yml` の `staticClients[].redirectURIs` は
> `https://<RAILS_HOST>/auth/dex/callback` として組み立てられます。
> `RAILS_HOST` を `app env set` で正しく指定しないと callback mismatch で
> ログインに失敗します。`DEX_ISSUER_HOST` も同様に `issuer` 検証に使用されます。

## カスタマイズ

### 本番環境

- `dex.yml` の `staticPasswords` は本番では必ず削除し、外部 IdP コネクタを
  設定してください(下記参照)
- `RAILS_OIDC_CLIENT_SECRET` / `OIDC_CLIENT_SECRET` は強いランダム値を `app env set`
  で指定してください
- HTTPS は conoha-proxy が Let's Encrypt で自動終端します(別途 nginx 不要ですが、
  ルート FQDN の互換性のため本サンプルでは nginx を残しています)
- 既知の制限: `DB_PASSWORD` / `SECRET_KEY_BASE` / `DEX_DB_PASSWORD` は compose の
  `${VAR:-default}` interpolation により env_file の user-set 値が反映されません。
  本番運用には [conoha-cli#166](https://github.com/crowdy/conoha-cli/issues/166)
  の解消が必要です(個別に手動で `compose.yml` の interpolation を外す回避策も可)

### Dex コネクタの追加

`dex.yml` に connectors セクションを追加して、外部 IdP と連携できます:

```yaml
connectors:
  - type: github
    id: github
    name: GitHub
    config:
      clientID: $GITHUB_CLIENT_ID
      clientSecret: $GITHUB_CLIENT_SECRET
      redirectURI: https://auth.example.com/dex/callback
```

### Rails のカスタマイズ

- `app/controllers/` と `app/views/` を編集して機能を追加
- `db/migrate/` に新しいマイグレーションを追加してスキーマを変更
- `config/initializers/omniauth.rb` で OIDC issuer / redirect_uri の組立ロジックを
  調整可能(`DEX_ISSUER_HOST` / `RAILS_HOST` が browser-facing、内部の
  token/userinfo は `dex:5556` 直接呼び出し)
