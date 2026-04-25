# hydra-python-api

Ory Hydra(OAuth2 / OpenID Connect サーバー)と Python(FastAPI)を組み合わせた認可サンプル。
Hydra Public エンドポイント(`:4444`)を別サブドメインで公開し、ブラウザ駆動の OAuth2
authorization code フローが HTTPS で完結するレイアウトです。

> **要件**: `conoha-cli >= v0.6.1` が必要です。`expose:` ブロックは v0.3.0 で
> 入りましたが、`blue_green: false`(本サンプルで Hydra を accessories 側に
> 固定するために必要)が正しく proxy にルーティングされるのは v0.6.1 以降です
> ([conoha-cli#163](https://github.com/crowdy/conoha-cli/issues/163))。

## 技術スタック

| レイヤー | 技術 | バージョン | 公開先 |
|---------|------|-----------|-------|
| ログイン/同意 + 保護 API | FastAPI (Python 3.12) | — | `hydra-python-api.example.com` (root web) |
| OAuth2 / OIDC サーバー (Public) | Ory Hydra | v2.2 | `auth.example.com` (`expose:` ブロック) |
| OAuth2 / OIDC サーバー (Admin) | Ory Hydra | v2.2 | **internal-only** (compose ネットワーク) |
| データベース | PostgreSQL | 17 | accessory(永続化) |

## アーキテクチャ

```
ブラウザ ──┬─ HTTPS hydra-python-api.example.com ─→ conoha-proxy ─→ app:9010
           │                                                          │
           │                                              /login, /consent, /callback,
           │                                              /api/me, /api/public
           │
           └─ HTTPS auth.example.com               ─→ conoha-proxy ─→ hydra:4444
                                                                      │ (Public)
                                              /oauth2/auth, /oauth2/token,
                                              /.well-known/openid-configuration, JWKS
                                                          │
                                          internal compose net
                                                          ▼
                                                  hydra:4445 (Admin, internal-only)
                                                  db:5432
```

- **app**: Python FastAPI 製ログイン/同意プロバイダー + 保護 API。`/login` と
  `/consent` は Hydra から redirect される URL、`/api/me` は Hydra Admin の
  introspection でトークンを検証する保護エンドポイント
- **hydra (Public :4444)**: OAuth2/OIDC エンドポイント(`/oauth2/auth`、
  `/oauth2/token`、`.well-known/openid-configuration` など)。`auth.example.com`
  で HTTPS 終端された conoha-proxy 越しに公開。`blue_green: false` で 1 インスタンス
  固定(認可フロー中の challenge 状態が Postgres に保存されるため)
- **hydra (Admin :4445)**: クライアント管理・トークン introspection 用 API。
  **インターネット非公開** — `app` から compose ネットワーク経由で `http://hydra:4445/admin`
  を直接呼ぶ。クライアント登録は SSH + `docker compose exec` で行う
- **db**: PostgreSQL 17。Hydra のクライアント・トークン・consent 状態を保持。
  accessory なので blue/green 切り替え時も生き残る

## 残存制限: Hydra Admin API は内部公開のみ

Admin API(`:4445`)はインターネットに **意図的に公開していません**。クライアント
登録 / シークレット発行 / 失効は強権限な操作のため、外部公開は危険です。本サンプルでは
以下のいずれかで運用してください:

1. **SSH + `docker compose exec`**(本サンプル付属の `setup.sh` 方式)
   ```bash
   ssh <SERVER>
   cd /opt/conoha/hydra-python-api
   docker compose exec hydra hydra create oauth2-client --endpoint http://localhost:4445 ...
   ```
2. **管理用サイドカー / 別アプリ** から compose ネットワーク経由で `http://hydra:4445`
   を直接呼ぶ(`app` がトークン introspection で行っているのと同じ経路)
3. 公開が必要な場合は別途認証付き reverse proxy(IP allowlist + Basic Auth +
   mTLS など)を前段に配置する

## ディレクトリ構成

```
hydra-python-api/
├── compose.yml      # 4 サービス定義(hydra, hydra-migrate, app, db)
├── conoha.yml       # web(app) + expose(hydra Public) + accessories(hydra-migrate, db)
├── Dockerfile       # Python アプリの image
├── main.py          # FastAPI ハンドラ(ログイン/同意/保護 API)
├── templates/       # login.html / consent.html
├── setup.sh         # OAuth2 クライアント登録スクリプト
└── README.md
```

## 設定ファイル解説

### conoha.yml

- `web:` — root の `hydra-python-api.example.com` に対応。`app` サービスの `:9010` を
  blue/green でルーティング(ログイン/同意 UI + 保護 API)
- `expose:` — サブドメインに追加サービスを生やすブロック。`auth.example.com` →
  `hydra:4444`(Public のみ)。`blue_green: false` で 1 インスタンス固定
- `accessories:` — blue/green 対象外で 1 インスタンスだけ走らせるサービス。
  `hydra-migrate`(one-shot SQL マイグレーション)と `db`

### compose.yml

- **hydra**: Ory Hydra v2.2。`expose: ["4444", "4445"]` で 2 ポート出すが、
  conoha-proxy が公開するのは `:4444` のみ(`expose:` ブロック由来)。`:4445`
  Admin API は compose ネットワーク内の他サービスからしか到達しない
- **hydra-migrate**: 起動時に SQL マイグレーションを 1 回実行し終了する one-shot
  ジョブ。`hydra` は `service_completed_successfully` 待ちで起動
- **app**: Python FastAPI。`HYDRA_ADMIN_URL=http://hydra:4445/admin` で
  introspection を呼ぶ
- **db**: PostgreSQL 17。`POSTGRES_PASSWORD` は compose の `environment:` 内で
  デフォルト値 `hydra` にフォールバック(後述の制限参照)

`hydra` サービスの `URLS_SELF_ISSUER` / `URLS_LOGIN` / `URLS_CONSENT` /
`SECRETS_SYSTEM` は **意図的に `environment:` から外して** あります。compose の
`${VAR:-default}` interpolation は `env_file`(CLI が注入する `.env.server`)を
上書きしてしまうため、これらを書くと `app env set` の値が反映されません。

## 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `URLS_SELF_ISSUER` | **必須** | Hydra の issuer URL(例: `https://auth.example.com/`)。
                                    OIDC discovery / JWT `iss` claim の基準値 |
| `URLS_LOGIN` | **必須** | login provider の URL(例:
                          `https://hydra-python-api.example.com/login`)。
                          Hydra が認可フロー開始時にユーザーをここへ redirect する |
| `URLS_CONSENT` | **必須** | consent provider の URL(例:
                            `https://hydra-python-api.example.com/consent`)。同上 |
| `SECRETS_SYSTEM` | **必須** | Hydra の暗号化用システム secret(`openssl rand -hex 32`) |
| `APP_HOST` | **必須** | Python アプリの公開 FQDN(例:
                        `hydra-python-api.example.com`)。`setup.sh` がクライアントの
                        `redirect_uri` を組み立てるのに使用 |
| `AUTH_HOST` | **必須** | Hydra Public の公開 FQDN(例: `auth.example.com`)。
                          `setup.sh` が authorization URL のヒントを表示するのに使用 |
| `POSTGRES_PASSWORD` | `hydra` | PostgreSQL パスワード(理想は変更したいが、現行
                                  では compose の `${VAR:-default}` interpolation が
                                  `.env.server` を上書きするため、デフォルトのまま使用される。
                                  [conoha-cli#166](https://github.com/crowdy/conoha-cli/issues/166)
                                  解消後に user-set 値が反映される) |

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.6.1`
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開する **2 つの FQDN** の DNS A レコードがサーバー IP を指している:
  - root: `hydra-python-api.example.com`(login/consent UI + 保護 API)
  - subdomain: `auth.example.com`(Hydra Public OAuth2 endpoint)

## ローカル実行

```bash
# コンテナ起動
docker compose up -d

# OAuth2 クライアント登録(Admin API は compose ネットワーク内のみ)
bash setup.sh
```

ローカルでは `app` が `http://localhost:9010` で、Hydra Public は
`http://localhost:4444`(compose の `expose:` のみで host port は出ないので、
ホストから叩くには `docker compose port hydra 4444` で動的割当を確認)になります。
ブラウザで `http://localhost:9010/login?login_challenge=...` の手動テストは可能ですが、
完全な OAuth2 フローを試すなら VPS デプロイの方が簡単です。

## ConoHa VPS デプロイ

```bash
# 1. サーバー作成(まだない場合)
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の root FQDN を自分の値に書き換える
#    - `hosts:` (root web) → 例: hydra-python-api.example.com
#    - `expose[].host` (auth サブドメイン) → 例: auth.example.com
#    ※ subdomain を `hosts:` にも書くと validation で reject されます

# 3. proxy を起動(サーバーごとに 1 回だけ)
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定(このステップは必須 — URLS_SELF_ISSUER / URLS_LOGIN /
#    URLS_CONSENT / APP_HOST / AUTH_HOST は必ず本番 FQDN にすること。
#    OIDC discovery / redirect URL がここから組み立てられる)
conoha app env set myserver \
  SECRETS_SYSTEM=$(openssl rand -hex 32) \
  POSTGRES_PASSWORD=$(openssl rand -base64 32) \
  URLS_SELF_ISSUER=https://auth.example.com/ \
  URLS_LOGIN=https://hydra-python-api.example.com/login \
  URLS_CONSENT=https://hydra-python-api.example.com/consent \
  AUTH_HOST=auth.example.com \
  APP_HOST=hydra-python-api.example.com

# 6. デプロイ
conoha app deploy myserver

# 7. OAuth2 クライアント登録(`setup.sh` が `docker compose exec` 経由で
#    Hydra Admin API を叩く — Admin は internal-only なのでこの方式が必要)
conoha server deploy myserver --script setup.sh --no-input
```

`setup.sh` の出力には `client_id` / `client_secret` が含まれます。必ずキャプチャしてください。

## 動作確認

### 1. コンテナの状態確認

```bash
conoha app status myserver
conoha app logs myserver
```

### 2. OIDC discovery の確認

```bash
curl https://auth.example.com/.well-known/openid-configuration
```

`issuer` フィールドが `https://auth.example.com/` を指していれば成功です。

### 3. ブラウザによる OAuth2 authorization code フロー

`setup.sh` が出力した authorization URL(`<CLIENT_ID>` を実値に置換)にアクセス:

```
https://auth.example.com/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=https://hydra-python-api.example.com/callback&scope=openid+profile+email&state=random-state-12345
```

1. Hydra が `https://hydra-python-api.example.com/login?login_challenge=...` に redirect
2. デモ認証: ユーザー名とパスワードに同じ値を入力(例: `admin` / `admin`)
3. consent 画面で scope を確認・許可
4. `/callback` に authorization code 付きで戻る
5. 表示された code で token 交換:
   ```bash
   curl -X POST https://auth.example.com/oauth2/token \
     -d grant_type=authorization_code \
     -d code=<AUTH_CODE> \
     -d redirect_uri=https://hydra-python-api.example.com/callback \
     -d client_id=<CLIENT_ID> \
     -d client_secret=<CLIENT_SECRET>
   ```
6. アクセストークンで保護 API を叩く:
   ```bash
   curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
     https://hydra-python-api.example.com/api/me
   ```

### 4. 公開エンドポイント(トークン不要)

```bash
curl https://hydra-python-api.example.com/api/public
```

## API エンドポイント

| エンドポイント | 認証 | 説明 |
|--------------|------|------|
| `GET /api/me` | Bearer トークン必須 | トークンの主体・スコープ・クライアント情報を返す |
| `GET /api/public` | 不要 | 公開エンドポイント |
| `GET /login` | 不要 | Hydra からの login challenge を処理する画面 |
| `GET /consent` | 不要 | Hydra からの consent challenge を処理する画面 |
| `GET /callback` | 不要 | OAuth2 認可コード受信(リダイレクト先) |
| `GET /health` | 不要 | ヘルスチェック |

## カスタマイズ

### 本番環境

- `main.py` の `login_post` を本物のユーザー認証ロジック(LDAP / IdP / DB lookup
  など)に差し替えてください
- `SECRETS_SYSTEM` は強いランダム値を `openssl rand -hex 32` で生成し
  `app env set` 経由で設定してください
- `--dev` フラグ(`hydra: command: serve all --dev`)を本番では外し、HTTPS と
  consent prompt の検証を厳格化してください
- HTTPS は conoha-proxy が Let's Encrypt で自動終端します(別途 nginx 不要)
- 既知の制限: `POSTGRES_PASSWORD` は compose の `${VAR:-default}` interpolation により
  `env_file` の user-set 値が反映されません。本番運用には
  [conoha-cli#166](https://github.com/crowdy/conoha-cli/issues/166)
  の解消が必要です(個別に手動で `compose.yml` の interpolation を外す回避策も可)

### Admin API へのアクセス

Hydra Admin API(`:4445`)は internal-only です。クライアントの追加・編集・削除は:

```bash
ssh <SERVER>
cd /opt/conoha/hydra-python-api
docker compose exec hydra hydra list oauth2-clients --endpoint http://localhost:4445
docker compose exec hydra hydra create oauth2-client --endpoint http://localhost:4445 ...
docker compose exec hydra hydra delete oauth2-client <CLIENT_ID> --endpoint http://localhost:4445
```

公開が必要な要件があれば、Admin に IP allowlist / Basic Auth / mTLS を備えた reverse
proxy を別途追加してください — このサンプルはあえて公開しません。
