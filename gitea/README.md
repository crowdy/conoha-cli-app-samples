# gitea

Gitea + Dex (OIDC) + PostgreSQL を使ったセルフホスティング Git サービスです。
Dex を OpenID Connect プロバイダーとして統合し、外部認証によるシングルサインオンが可能です。

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| Git サーバー | Gitea | latest |
| OIDC プロバイダー | Dex | v2.45.1 |
| データベース | PostgreSQL | 17 |

## アーキテクチャ

```
ブラウザ → conoha-proxy (HTTPS, FQDN) → gitea:3000
                                          │
                                          │ internal compose net
                                          ▼
                                    OIDC: dex:5556  ←┐
                                    DB:   db:5432   ←┤
                                                    │
                                            (gitea container, ssh:22)
```

- **gitea**: セルフホスティング Git サーバー。HTTP UI (`:3000`) は conoha-proxy 経由で公開、`git+ssh` ポート（`:22`）は **コンテナ内部のみ** — 後述の `docker exec` で利用
- **dex**: OIDC プロバイダー。Gitea からだけ呼ばれるため accessory（外部公開なし）
- **db**: PostgreSQL 17。`gitea` と `dex` の 2 つのデータベースを管理。データは Docker ボリュームに永続化

## ディレクトリ構成

```
gitea/
├── compose.yml     # 3サービス定義（gitea, dex, db）
├── dex.yml         # Dex 設定（ストレージ、静的クライアント、テストユーザー）
├── init-db.sh      # PostgreSQL 初期化スクリプト（gitea + dex DB 作成）
└── README.md
```

## 設定ファイル解説

### compose.yml

3つのサービスを定義します:

- **db**: PostgreSQL 17。`init-db.sh` を `/docker-entrypoint-initdb.d/` にマウントし、初回起動時に `gitea` と `dex` の2つのデータベースを作成します
- **dex**: Dex OIDC プロバイダー。`dex.yml` を設定ファイルとしてマウント。db の healthcheck 完了を待って起動します
- **gitea**: Gitea 本体。db と dex の healthcheck 完了を待って起動します

すべての設定値は `${VAR:-default}` パターンで環境変数から上書き可能です。

### dex.yml

Dex の設定ファイルです:

- **storage**: PostgreSQL をバックエンドに使用（`dex` データベース）
- **staticClients**: Gitea を OIDC クライアントとして登録。`redirectURIs` は Gitea の OAuth2 コールバック URL
- **staticPasswords**: テスト用ユーザー `admin@example.com`（パスワード: `password`）を定義。本番では削除してください
- **oauth2.skipApprovalScreen**: 承認画面をスキップ（同一組織内利用を想定）

### init-db.sh

PostgreSQL の初回起動時に実行される初期化スクリプトです。`gitea` データベース（`POSTGRES_DB` で自動作成）に加えて、`dex` データベースとユーザーを作成します。

## 環境変数

| 変数名 | デフォルト値 | 説明 |
|--------|-------------|------|
| `GITEA_VERSION` | `latest` | Gitea イメージタグ |
| `GITEA_DB_NAME` | `gitea` | Gitea データベース名 |
| `GITEA_DB_USER` | `gitea` | Gitea データベースユーザー |
| `GITEA_DB_PASSWORD` | `gitea` | Gitea データベースパスワード（必ず変更） |
| `DEX_VERSION` | `v2.45.1` | Dex イメージタグ |
| `DEX_ISSUER_HOST` | `localhost` | Dex issuer ホスト名（公開 FQDN に揃える） |
| `DEX_DB_NAME` | `dex` | Dex データベース名 |
| `DEX_DB_USER` | `dex` | Dex データベースユーザー |
| `DEX_DB_PASSWORD` | `dex` | Dex データベースパスワード（必ず変更） |
| `GITEA_OAUTH2_CLIENT_ID` | `gitea` | Dex に登録する OAuth2 クライアント ID |
| `GITEA_OAUTH2_CLIENT_SECRET` | `gitea-dex-secret` | OAuth2 クライアントシークレット（必ず変更） |
| `GITEA_HOST` | `localhost` | Gitea のホスト名（コールバック URL に使用、公開 FQDN に揃える） |
| `POSTGRES_VERSION` | `17-alpine` | PostgreSQL イメージタグ |

> **note**: 旧 `GITEA_HTTP_PORT` / `GITEA_SSH_PORT` / `DEX_HTTP_PORT` は削除しました
> （proxy が HTTP のホスト側ポートを動的に決めるため、固定値にする意味がなくなった）。

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
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

# 5. 環境変数を設定（このステップは必須 — compose のデフォルトは
#    公開リポジトリに記載されています）
conoha app env set myserver \
  GITEA_DB_PASSWORD=$(openssl rand -base64 32) \
  DEX_DB_PASSWORD=$(openssl rand -base64 32) \
  GITEA_OAUTH2_CLIENT_SECRET=$(openssl rand -hex 32) \
  DEX_ISSUER_HOST=gitea.example.com \
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

ブラウザで `https://<あなたの FQDN>` にアクセスし、初期セットアップ画面で管理者アカウントを作成します。初回は Let's Encrypt 証明書発行に数十秒かかる場合があります。

### 3. Dex (OIDC) 認証プロバイダーの登録

Gitea の管理画面から OIDC プロバイダーを登録します:

1. **サイト管理** → **認証ソース** → **認証ソースを追加**
2. 以下の値を入力:

| 項目 | 値 |
|------|-----|
| 認証タイプ | OAuth2 |
| 認証名 | `dex` |
| OAuth2 プロバイダー | OpenID Connect |
| クライアント ID | `gitea`（または `GITEA_OAUTH2_CLIENT_ID` の値） |
| クライアントシークレット | step 5 で設定した `GITEA_OAUTH2_CLIENT_SECRET` |
| OpenID Connect 自動検出 URL | `http://dex:5556/dex/.well-known/openid-configuration` |

3. **認証ソースを追加** をクリック

### 4. Dex 経由でログイン

1. Gitea のログイン画面に「Dex でサインイン」ボタンが表示されます
2. クリックすると Dex のログイン画面に遷移します
3. テスト用ユーザー（`admin@example.com` / `password`）でログインできます

### 5. Git SSH アクセス（compose 内部からのみ）

> **重要**: conoha-proxy は HTTP のみフロントするため、Gitea コンテナの `:22`
> はホストには公開されません。git+ssh を使うにはサーバーに SSH ログインしたあと、
> `docker exec` で gitea コンテナに入る必要があります。

ホストから直接 git+ssh で push / clone することは **このサンプルでは想定していません**。
代わりに次のいずれかを採用してください:

- **HTTPS で push / clone**（推奨）: `git clone https://<あなたの FQDN>/user/repo.git`
  Gitea の Personal Access Token (Settings > Applications) を使えばパスワード入力なしで push できます。
- **VPS 内で git 作業**: `ssh root@<サーバー IP>` してから VPS 上で `git clone` するか、
  `docker exec -it $(docker ps -q -f name=gitea) git ...` を使う。

ssh 越しの git+ssh をサーバー外部から使いたい場合は、別途ホスト側で `:22` を
バインドする (gitea を accessory にして `ports: ["2222:22"]` を残し、blue/green
対象から外す) などの構成変更が必要です。本サンプルではスコープ外です。

## カスタマイズ

### 本番環境

- `GITEA_DB_PASSWORD`、`DEX_DB_PASSWORD`、`GITEA_OAUTH2_CLIENT_SECRET` は必ず変更してください（step 5 で `openssl rand` を使う方式に従ってください）
- `dex.yml` の `staticPasswords` セクションを削除し、LDAP や SAML などの外部コネクタに置き換えてください
- `DEX_ISSUER_HOST` と `GITEA_HOST` を実際の FQDN に設定してください
- HTTPS は conoha-proxy が Let's Encrypt で自動終端します（別途 nginx 不要）

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
      redirectURI: http://your-dex-host:5556/dex/callback
```

### Gitea 設定

`GITEA__` プレフィックスの環境変数で Gitea のあらゆる設定を変更できます。例:

- `GITEA__service__DISABLE_REGISTRATION=true` — ローカル登録を無効化（OIDC のみ）
- `GITEA__service__ALLOW_ONLY_EXTERNAL_REGISTRATION=true` — 外部認証のみ許可
- CI/CD には Gitea Actions（GitHub Actions 互換）が利用可能
