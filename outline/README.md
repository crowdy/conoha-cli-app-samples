# outline

Notion 代替のセルフホスティングチーム Wiki・ナレッジベース。Markdown エディタと
豊富なコラボレーション機能を備えています。Dex を別サブドメインで公開し、
ブラウザ OIDC ログインも動作するレイアウトに移行しました。

> **要件**: `conoha-cli >= v0.6.1` が必要です。`expose:` ブロックは v0.3.0 で
> 入りましたが、`blue_green: false`(本サンプルで dex を accessories 側に
> 固定するために必要)が正しく proxy にルーティングされるのは v0.6.1 以降です
> ([conoha-cli#163](https://github.com/crowdy/conoha-cli/issues/163))。

## 技術スタック

| レイヤー | 技術 | バージョン | 公開先 |
|---------|------|-----------|-------|
| Wiki | Outline | v0.82 | `outline.example.com` (root web) |
| OIDC プロバイダー | Dex | v2.39.1 | `dex.example.com` (`expose:` ブロック) |
| データベース | PostgreSQL | 16 | accessory(永続化) |
| キャッシュ | Redis | 7 | accessory |

## アーキテクチャ

```
ブラウザ ──┬─ HTTPS outline.example.com ─→ conoha-proxy ─→ outline:3000
           │                                                  │
           └─ HTTPS dex.example.com     ─→ conoha-proxy ─→ dex:5556
                                                              │
                                          internal compose net
                                                              ▼
                                                          db:5432
                                                          redis:6379
```

- **outline**: Outline 本体。HTTP UI (`:3000`) は `outline.example.com` で
  conoha-proxy 経由公開。OIDC token / userinfo の server-to-server 呼び出しは
  内部の `dex:5556` を直接使用
- **dex**: OIDC プロバイダー。`dex.example.com` で公開され、ブラウザの discovery /
  redirect フローが HTTPS で完結する。`blue_green: false` で 1 インスタンス固定
  (sqlite ベースのセッションが blue/green スロットで分散しない)
- **db**: PostgreSQL 16。データは Docker ボリュームに永続化(accessory なので
  blue/green 切り替え時も生き残る)
- **redis**: Redis 7。キャッシュ・WebSocket Pub/Sub 用

## ディレクトリ構成

```
outline/
├── compose.yml      # 4サービス定義(outline, dex, db, redis)
├── conoha.yml       # web(outline) + expose(dex) + accessories(db, redis)
├── dex-config.yml   # Dex 設定(プレースホルダ + 静的ユーザー)
└── README.md
```

## 設定ファイル解説

### conoha.yml

- `web:` — root の `outline.example.com` に対応。`outline` サービスの `:3000` を
  blue/green でルーティング
- `expose:` — サブドメインに追加サービスを生やすブロック。ここでは
  `dex.example.com` → `dex:5556` をマップ。`blue_green: false` で 1 インスタンス固定
- `accessories:` — blue/green 対象外で 1 インスタンスだけ走らせるサービス。
  `db` と `redis`

### compose.yml

- **db**: PostgreSQL 16。`POSTGRES_PASSWORD` は compose の `environment:` 内で
  デフォルト値 `outline` にフォールバック(後述の制限参照)
- **redis**: Redis 7。compose 内部からのみ到達
- **dex**: Dex OIDC プロバイダー。`dex-config.yml` を `__VAR__` 形式の
  プレースホルダ付きでマウントし、entrypoint で sed が `.env.server` の値で
  実 FQDN/secret に置換してから dex を起動
- **outline**: Outline 本体。db / redis の healthcheck を待って起動

### dex-config.yml

- **issuer**: `https://${DEX_ISSUER_HOST}/dex`(conoha-proxy が HTTPS 終端)
- **storage**: sqlite3(`/var/dex/dex.db` に永続化)
- **staticClients**: Outline を OIDC クライアントとして登録。
  `redirectURIs` は `https://${OUTLINE_HOST}/auth/oidc.callback`
- **staticPasswords**: テスト用ユーザー `admin@example.com`(パスワード: `password`)
  を定義。本番では削除してください
- **oauth2.skipApprovalScreen**: 承認画面をスキップ(同一組織内利用を想定)

## 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `DB_PASSWORD` | `outline` | PostgreSQL パスワード(理想は変更したいが、現行
                            では compose の `${VAR:-default}` interpolation が
                            `.env.server` を上書きするため、デフォルトのまま使用される。
                            `conoha-cli#166` 解消後に user-set 値が反映される) |
| `SECRET_KEY` | placeholder | Outline の暗号化シード。同上の制限あり、開発用途想定 |
| `UTILS_SECRET` | placeholder | Outline ユーティリティ用 secret。同上 |
| `URL` | **必須** | Outline を公開する URL(例: `https://outline.example.com`)。
                  asset URL や OIDC redirect の基準値 |
| `OIDC_AUTH_URI` | **必須** | Dex の auth endpoint(例:
                              `https://dex.example.com/dex/auth`) |
| `OIDC_CLIENT_SECRET` | **必須** | Outline ↔ Dex 間の OIDC client secret。
                                  `dex-config.yml` の `staticClients[].secret` と一致させる |
| `DEX_ISSUER_HOST` | **必須** | Dex を公開する FQDN(例: `dex.example.com`) |
| `OUTLINE_HOST` | **必須** | Outline を公開する FQDN(例: `outline.example.com`) |
| `OIDC_CLIENT_ID` | `outline` | Dex 側に登録する OIDC クライアント ID |
| `PGSSLMODE` | `disable` | PostgreSQL SSL モード(同一ホストの compose 内部接続) |

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.6.1`
- ConoHa VPS3 アカウント
- SSH キーペア設定済み
- 公開する **2 つの FQDN** の DNS A レコードがサーバー IP を指している:
  - root: `outline.example.com`(Outline UI)
  - subdomain: `dex.example.com`(OIDC issuer)

## デプロイ

```bash
# 1. サーバー作成(まだない場合)
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. conoha.yml の root FQDN を自分の値に書き換える
#    - `hosts:` (root web) → 例: outline.example.com
#    - `expose[].host` (dex サブドメイン) → 例: dex.example.com
#    ※ subdomain を `hosts:` にも書くと validation で reject されます

# 3. proxy を起動(サーバーごとに 1 回だけ)
conoha proxy boot --acme-email you@example.com myserver

# 4. アプリ登録
conoha app init myserver

# 5. 環境変数を設定(このステップは必須 — DEX_ISSUER_HOST / OUTLINE_HOST /
#    URL / OIDC_AUTH_URI は必ず本番 FQDN にすること。OIDC redirect / issuer
#    URL がここから組み立てられる)
conoha app env set myserver \
  SECRET_KEY=$(openssl rand -hex 32) \
  UTILS_SECRET=$(openssl rand -hex 32) \
  DB_PASSWORD=$(openssl rand -base64 32) \
  OIDC_CLIENT_ID=outline \
  OIDC_CLIENT_SECRET=$(openssl rand -base64 32) \
  URL=https://outline.example.com \
  OIDC_AUTH_URI=https://dex.example.com/dex/auth \
  DEX_ISSUER_HOST=dex.example.com \
  OUTLINE_HOST=outline.example.com

# 6. デプロイ
conoha app deploy myserver
```

## 動作確認

### 1. コンテナの状態確認

```bash
conoha app status myserver
conoha app logs myserver
```

### 2. Outline の初期セットアップ

ブラウザで `https://<outline FQDN>` にアクセスし、初回はログイン画面が表示されます。
初回は Let's Encrypt 証明書発行に数十秒かかる場合があります(2 つの FQDN 分)。

### 3. Dex 経由の OIDC ログイン

Outline は OIDC を組み込みで使うため、ログイン画面に **Continue with Dex Login**
ボタンが表示されます(`OIDC_DISPLAY_NAME=Dex Login` から)。

1. **Continue with Dex Login** をクリック
2. Dex のログイン画面で `staticPasswords` に定義した `admin@example.com` /
   `password` を入力
3. Outline に戻り、ユーザー名・チームスペース名を設定
4. ホーム画面に到達することを確認

> **重要**: `dex-config.yml` の `staticClients[].redirectURIs` は
> `https://<outline FQDN>/auth/oidc.callback` でハードコードされています。
> `OUTLINE_HOST` を `app env set` で正しく指定しないと callback mismatch で
> ログインに失敗します。

## カスタマイズ

### 本番環境

- `dex-config.yml` の `staticPasswords` は本番では必ず削除し、外部 IdP コネクタを
  設定してください(下記参照)
- `OIDC_CLIENT_SECRET` は強いランダム値を `app env set` で指定してください
- HTTPS は conoha-proxy が Let's Encrypt で自動終端します(別途 nginx 不要)
- 既知の制限: `DB_PASSWORD` / `SECRET_KEY` / `UTILS_SECRET` は compose の
  `${VAR:-default}` interpolation により env_file の user-set 値が反映されません。
  本番運用には [conoha-cli#166](https://github.com/crowdy/conoha-cli/issues/166)
  の解消が必要です(個別に手動で `compose.yml` の interpolation を外す回避策も可)

### Dex コネクタの追加

`dex-config.yml` に connectors セクションを追加して、外部 IdP と連携できます:

```yaml
connectors:
  - type: github
    id: github
    name: GitHub
    config:
      clientID: $GITHUB_CLIENT_ID
      clientSecret: $GITHUB_CLIENT_SECRET
      redirectURI: https://dex.example.com/dex/callback
```

### Outline 設定

`environment:` プレフィックスの環境変数で Outline のあらゆる設定を変更できます。例:

- `FILE_STORAGE=s3` + S3 関連環境変数 — オブジェクトストレージへのファイル保存
- SMTP (`SMTP_HOST` / `SMTP_USERNAME` / ...) — Magic Link / 通知メール
- 詳細は [Outline 公式ドキュメント](https://docs.getoutline.com/s/hosting/doc/configuration-RYTrSyrvcv)
