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
ブラウザ → :3000 → [Gitea] ──OIDC──→ :5556 → [Dex]
              │                              │
              │ postgres                     │ postgres
              ▼                              ▼
          [PostgreSQL 17] ← DB: gitea    DB: dex
              SSH: :2222
```

- **gitea**: セルフホスティング Git サーバー。Web UI（:3000）と SSH（:2222）を公開
- **dex**: OIDC プロバイダー。Gitea の外部認証バックエンドとして機能（:5556）
- **db**: PostgreSQL 17。`gitea` と `dex` の2つのデータベースを管理。データは Docker ボリューム `db_data` に永続化

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
| `GITEA_HTTP_PORT` | `3000` | Gitea Web UI ポート |
| `GITEA_SSH_PORT` | `2222` | Gitea SSH ポート |
| `GITEA_DB_NAME` | `gitea` | Gitea データベース名 |
| `GITEA_DB_USER` | `gitea` | Gitea データベースユーザー |
| `GITEA_DB_PASSWORD` | `gitea` | Gitea データベースパスワード |
| `DEX_VERSION` | `v2.45.1` | Dex イメージタグ |
| `DEX_HTTP_PORT` | `5556` | Dex HTTP ポート |
| `DEX_ISSUER_HOST` | `localhost` | Dex の issuer ホスト名 |
| `DEX_DB_NAME` | `dex` | Dex データベース名 |
| `DEX_DB_USER` | `dex` | Dex データベースユーザー |
| `DEX_DB_PASSWORD` | `dex` | Dex データベースパスワード |
| `GITEA_OAUTH2_CLIENT_ID` | `gitea` | Dex に登録する OAuth2 クライアント ID |
| `GITEA_OAUTH2_CLIENT_SECRET` | `gitea-dex-secret` | OAuth2 クライアントシークレット |
| `GITEA_HOST` | `localhost` | Gitea のホスト名（コールバック URL に使用） |
| `POSTGRES_VERSION` | `17-alpine` | PostgreSQL イメージタグ |

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（まだない場合）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name gitea

# 環境変数を設定（パスワードを変更してください）
conoha app env set myserver --app-name gitea \
  GITEA_DB_PASSWORD=your_gitea_db_password \
  DEX_DB_PASSWORD=your_dex_db_password \
  GITEA_OAUTH2_CLIENT_SECRET=your_oauth2_secret \
  DEX_ISSUER_HOST=your-server-ip \
  GITEA_HOST=your-server-ip

# デプロイ
conoha app deploy myserver --app-name gitea
```

## 動作確認

### 1. コンテナの状態確認

```bash
conoha app status myserver --app-name gitea
conoha app logs myserver --app-name gitea
```

### 2. Gitea の初期セットアップ

ブラウザで `http://<サーバーIP>:3000` にアクセスし、初期セットアップ画面で管理者アカウントを作成します。

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
| クライアントシークレット | `gitea-dex-secret`（または `GITEA_OAUTH2_CLIENT_SECRET` の値） |
| OpenID Connect 自動検出 URL | `http://dex:5556/dex/.well-known/openid-configuration` |

3. **認証ソースを追加** をクリック

### 4. Dex 経由でログイン

1. Gitea のログイン画面に「Dex でサインイン」ボタンが表示されます
2. クリックすると Dex のログイン画面に遷移します
3. テスト用ユーザー（`admin@example.com` / `password`）でログインできます

### 5. Git SSH アクセス

```bash
git clone ssh://git@<サーバーIP>:2222/user/repo.git
```

## カスタマイズ

### 本番環境

- `GITEA_DB_PASSWORD`、`DEX_DB_PASSWORD`、`GITEA_OAUTH2_CLIENT_SECRET` は必ず変更してください
- `dex.yml` の `staticPasswords` セクションを削除し、LDAP や SAML などの外部コネクタに置き換えてください
- `DEX_ISSUER_HOST` と `GITEA_HOST` を実際のドメイン名に設定してください
- HTTPS が必要な場合は nginx リバースプロキシを前段に追加してください

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
