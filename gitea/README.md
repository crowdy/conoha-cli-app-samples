# gitea

Gitea + PostgreSQL を使ったセルフホスティング Git サービスです。Dex を別サブドメインで
公開し、ブラウザ OIDC ログインも動作するレイアウトに移行しました。

> **要件**: `conoha-cli >= v0.6.1` が必要です。`expose:` ブロックは v0.3.0 で
> 入りましたが、`blue_green: false`(本サンプルで dex を accessories 側に
> 固定するために必要)が正しく proxy にルーティングされるのは v0.6.1 以降です
> ([conoha-cli#163](https://github.com/crowdy/conoha-cli/issues/163))。

## 技術スタック

| レイヤー | 技術 | バージョン | 公開先 |
|---------|------|-----------|-------|
| Git サーバー | Gitea | latest | `gitea.example.com` (root web) |
| OIDC プロバイダー | Dex | v2.45.1 | `dex.example.com` (`expose:` ブロック) |
| データベース | PostgreSQL | 17 | accessory(永続化) |

## アーキテクチャ

```
ブラウザ ──┬─ HTTPS gitea.example.com ─→ conoha-proxy ─→ gitea:3000
           │                                                 │
           └─ HTTPS dex.example.com   ─→ conoha-proxy ─→ dex:5556
                                                             │
                                          internal compose net
                                                             ▼
                                                          db:5432
                                                          (gitea container, ssh:22)
```

- **gitea**: セルフホスティング Git サーバー。HTTP UI (`:3000`) は `gitea.example.com` で
  conoha-proxy 経由公開、`git+ssh` ポート(`:22`)は **コンテナ内部のみ** — 後述の
  `docker exec` で利用
- **dex**: OIDC プロバイダー。`dex.example.com` で公開され、ブラウザの discovery / redirect
  フローが HTTPS で完結する。`blue_green: false` で 1 インスタンス固定(セッションが
  blue/green スロットで分散しない)
- **db**: PostgreSQL 17。`gitea` と `dex` の 2 つのデータベースを管理。データは Docker
  ボリュームに永続化(accessory なので blue/green 切り替え時も生き残る)

## ディレクトリ構成

```
gitea/
├── compose.yml     # 3サービス定義(gitea, dex, db)
├── conoha.yml      # web(gitea) + expose(dex) + accessories(db)
├── dex.yml         # Dex 設定(ストレージ、静的クライアント、テストユーザー)
├── init-db.sh      # PostgreSQL 初期化スクリプト(gitea + dex DB 作成)
└── README.md
```

## 設定ファイル解説

### conoha.yml

- `web:` — root の `gitea.example.com` に対応。`gitea` サービスの `:3000` を blue/green
  でルーティング
- `expose:` — サブドメインに追加サービスを生やすブロック。ここでは `dex.example.com` →
  `dex:5556` をマップ。`blue_green: false` で 1 インスタンス固定
- `accessories:` — blue/green 対象外で 1 インスタンスだけ走らせるサービス。`db` のみ

### compose.yml

3 つのサービスを定義します:

- **db**: PostgreSQL 17。`init-db.sh` を `/docker-entrypoint-initdb.d/` にマウントし、
  初回起動時に `gitea` と `dex` の 2 つのデータベースを作成します
- **dex**: Dex OIDC プロバイダー。`dex.yml` を設定ファイルとしてマウント。db の
  healthcheck 完了を待って起動します
- **gitea**: Gitea 本体。db と dex の healthcheck 完了を待って起動します

すべての設定値は `${VAR:-default}` パターンで環境変数から上書き可能です。

### dex.yml

Dex の設定ファイルです:

- **issuer**: `https://${DEX_ISSUER_HOST}/dex`(conoha-proxy が HTTPS 終端)
- **storage**: PostgreSQL をバックエンドに使用(`dex` データベース)
- **staticClients**: Gitea を OIDC クライアントとして登録。`redirectURIs` は
  `https://${GITEA_HOST}/user/oauth2/dex/callback`
- **staticPasswords**: テスト用ユーザー `admin@example.com`(パスワード: `password`)を
  定義。本番では削除してください
- **oauth2.skipApprovalScreen**: 承認画面をスキップ(同一組織内利用を想定)

### init-db.sh

PostgreSQL の初回起動時に実行される初期化スクリプトです。`gitea` データベース
(`POSTGRES_DB` で自動作成)に加えて、`dex` データベースとユーザーを作成します。

## 環境変数

| 変数名 | デフォルト値 | 説明 |
|--------|-------------|------|
| `GITEA_VERSION` | `latest` | Gitea イメージタグ |
| `GITEA_DB_NAME` | `gitea` | Gitea データベース名 |
| `GITEA_DB_USER` | `gitea` | Gitea データベースユーザー |
| `GITEA_DB_PASSWORD` | `gitea` | Gitea データベースパスワード(必ず変更) |
| `DEX_VERSION` | `v2.45.1` | Dex イメージタグ |
| `DEX_DB_NAME` | `dex` | Dex データベース名 |
| `DEX_DB_USER` | `dex` | Dex データベースユーザー |
| `DEX_DB_PASSWORD` | `dex` | Dex データベースパスワード(必ず変更) |
| `DEX_ISSUER_HOST` | `localhost` | **必須**: Dex を公開する FQDN(例: `dex.example.com`) |
| `GITEA_HOST` | `localhost` | **必須**: Gitea を公開する FQDN(例: `gitea.example.com`) |
| `GITEA_OAUTH2_CLIENT_ID` | `gitea` | Dex 側に登録する OIDC クライアント ID |
| `GITEA_OAUTH2_CLIENT_SECRET` | `gitea-dex-secret` | OIDC クライアント secret(必ず変更) |
| `POSTGRES_VERSION` | `17-alpine` | PostgreSQL イメージタグ |

> **note**: `DEX_ISSUER_HOST` / `GITEA_HOST` のデフォルト値 `localhost` は OIDC 動作には
> 使えません — デプロイ時に必ず実 FQDN を `conoha app env set` で上書きしてください
> (deploy 手順 step 5 参照)。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.6.1`
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開する **2 つの FQDN** の DNS A レコードがサーバー IP を指している:
  - root: `gitea.example.com`(Gitea UI)
  - subdomain: `dex.example.com`(OIDC issuer)

## デプロイ

```bash
# 1. サーバー作成(まだない場合)
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の root FQDN を自分の値に書き換える
#    - `hosts:` (root web) → 例: gitea.example.com
#    - `expose[].host` (dex サブドメイン) → 例: dex.example.com
#    ※ subdomain を `hosts:` にも書くと validation で reject されます

# 3. proxy を起動(サーバーごとに 1 回だけ)
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定(このステップは必須 — DEX_ISSUER_HOST / GITEA_HOST は
#    必ず本番 FQDN にすること。OIDC redirect / issuer URL がここから組み立てられる)
conoha app env set myserver \
  GITEA_DB_PASSWORD=$(openssl rand -base64 32) \
  DEX_DB_PASSWORD=$(openssl rand -base64 32) \
  GITEA_OAUTH2_CLIENT_ID=gitea \
  GITEA_OAUTH2_CLIENT_SECRET=$(openssl rand -base64 32) \
  DEX_ISSUER_HOST=dex.example.com \
  GITEA_HOST=gitea.example.com

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

### 1. コンテナの状態確認

```bash
conoha app status myserver
conoha app logs myserver
```

### 2. Gitea の初期セットアップ

ブラウザで `https://<gitea FQDN>` にアクセスし、初期セットアップ画面で管理者アカウントを
作成します。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります(2 つの FQDN 分)。

### 3. Dex 経由の OIDC ログインを設定

1. Gitea 管理者でログイン → **サイト管理 > 認証ソース > 新規追加**
2. 認証種別: **OAuth2**
3. 各フィールド:
   - **名前**: **必ず `dex`(小文字、完全一致)**。`dex.yml` の `redirectURIs` が
     `https://<gitea FQDN>/user/oauth2/dex/callback` と path segment `dex` で
     ハードコードされているため、ここで `Dex` / `dex-oidc` 等の別名を入れると
     callback mismatch でログインに失敗します
   - **OAuth2 プロバイダー**: `OpenID Connect`
   - **クライアント ID**: `${GITEA_OAUTH2_CLIENT_ID}` の値(デフォルト `gitea`)
   - **クライアント Secret**: `${GITEA_OAUTH2_CLIENT_SECRET}` の値(step 5 で設定したもの)
   - **OpenID Connect Auto Discovery URL**: `https://<dex FQDN>/dex/.well-known/openid-configuration`
4. 保存後、ログアウトしてログイン画面の **Dex でサインイン** ボタンを押す
5. Dex の `staticPasswords` に定義した `admin@example.com` / `password` でログイン
6. Gitea にユーザーが自動作成されることを確認

### 4. Git SSH アクセス(compose 内部からのみ)

> **重要**: conoha-proxy は HTTP のみフロントするため、Gitea コンテナの `:22`
> はホストには公開されません。git+ssh を使うにはサーバーに SSH ログインしたあと、
> `docker exec` で gitea コンテナに入る必要があります。

ホストから直接 git+ssh で push / clone することは **このサンプルでは想定していません**。
代わりに次のいずれかを採用してください:

- **HTTPS で push / clone**(推奨): `git clone https://<gitea FQDN>/user/repo.git`
  Gitea の Personal Access Token (Settings > Applications) を使えばパスワード入力なしで push できます。
- **VPS 内で git 作業**: `ssh root@<サーバー IP>` してから VPS 上で `git clone` するか、
  `docker exec -it $(docker ps -q -f name=gitea) git ...` を使う。

ssh 越しの git+ssh をサーバー外部から使いたい場合は、別途ホスト側で `:22` を
バインドする (gitea を accessory にして `ports: ["2222:22"]` を残し、blue/green
対象から外す) などの構成変更が必要です。本サンプルではスコープ外です。

## カスタマイズ

### 本番環境

- `GITEA_DB_PASSWORD`、`DEX_DB_PASSWORD`、`GITEA_OAUTH2_CLIENT_SECRET` は必ず変更してください
  (deploy step 5 で `openssl rand` を使う方式に従ってください)
- HTTPS は conoha-proxy が Let's Encrypt で自動終端します(別途 nginx 不要)
- `dex.yml` の `staticPasswords` は本番では必ず削除し、外部 IdP コネクタを設定してください
  (下記参照)

### Dex コネクタの追加

`dex.yml` に connectors セクションを追加して、外部 IdP と連携できます:

```yaml
connectors:
  - type: ldap
    id: ldap
    name: LDAP
    config:
      host: ldap.example.com:636
      # ... LDAP 設定
  - type: github
    id: github
    name: GitHub
    config:
      clientID: $GITHUB_CLIENT_ID
      clientSecret: $GITHUB_CLIENT_SECRET
      redirectURI: https://dex.example.com/dex/callback
```

### Gitea 設定

`GITEA__` プレフィックスの環境変数で Gitea のあらゆる設定を変更できます。例:

- `GITEA__service__DISABLE_REGISTRATION=true` — ローカル登録を無効化(OIDC のみ)
- `GITEA__service__ALLOW_ONLY_EXTERNAL_REGISTRATION=true` — 外部認証のみ許可
- CI/CD には Gitea Actions(GitHub Actions 互換)が利用可能
