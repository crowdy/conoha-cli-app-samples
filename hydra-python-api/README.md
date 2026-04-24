# hydra-python-api

Ory Hydra（OAuth2 / OpenID Connect サーバー）と Python（FastAPI）を組み合わせた認可サンプルです。

Hydra が OAuth2 フローを処理し、Python アプリがログイン/同意画面の提供とトークン検証付き API を担当します。

## 構成

- Ory Hydra v2.2（OAuth2 / OIDC サーバー）
- Python 3.12 + FastAPI（ログイン/同意プロバイダー + 保護された API）
- PostgreSQL 17（Hydra のデータストア）
- ポート: 4444（Hydra Public）、4445（Hydra Admin）、9010（Python アプリ）

## アーキテクチャ

```
ブラウザ ──→ Hydra (:4444)  ←──→  PostgreSQL
              │  ↑
              ↓  │
          Python App (:9010)
          ├── /login     ← ログイン画面
          ├── /consent   ← 同意画面
          ├── /callback  ← 認可コード受信
          └── /api/me    ← トークン検証付き API
```

1. クライアントが Hydra の認可エンドポイントにリクエスト
2. Hydra がユーザーを Python アプリのログイン画面にリダイレクト
3. ログイン成功後、Hydra が同意画面にリダイレクト
4. 同意後、Hydra がアクセストークンを発行
5. クライアントがトークンを使って `/api/me` にアクセス

## ローカル実行

```bash
# コンテナ起動
docker compose up -d

# セットアップ（OAuth2 クライアント登録）
bash setup.sh
```

`setup.sh` が完了すると CLIENT_ID と CLIENT_SECRET が表示されます。ローカル実行時は 3 ポート全てが手元の 127.0.0.1 で公開されるため、後述の VPS 向けの制限には当たりません。

## ⚠ 既知の制限: ブラウザ OAuth2 フローが完結しない

**このサンプルの実 OAuth2 認可フローは現行の conoha-proxy 構成では完結しません**。理由:

- ブラウザ → `hydra:4444/oauth2/auth` へのリダイレクトが必要
- Hydra から `app:9010/login` へのリダイレクトも browser 経由
- conoha-proxy は FQDN につき 1 サービスしかフロントできないため、`app:9010` か `hydra:4444` のどちらか一方しか外部公開できない

本 PR では **`app:9010` を proxy フロント対象** として migrate しました。`app` 単体の login / consent 画面は `https://<FQDN>/login` 等で開けますが、通常の OAuth2 クライアントが `hydra:4444/oauth2/auth` にリダイレクトする経路は動きません。

完全な E2E 動作には Hydra を別 `conoha.yml` プロジェクトに切り出して `auth.example.com` サブドメインで proxy 下に並べる構成が必要です（future batch で対応予定）。

## ConoHa VPS デプロイ

### 前提条件

- conoha-cli がインストール・認証済み
- SSH キーペア設定済み
- 公開したい FQDN の DNS A レコードがサーバー IP を指している

### 手順

```bash
# 1. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 2. proxy を起動（サーバーごとに 1 回だけ）
conoha proxy boot --acme-email you@example.com <SERVER>

# 3. アプリ初期化
conoha app init <SERVER>

# 4. デプロイ（hydra-python-api ディレクトリから実行）
conoha app deploy <SERVER>

# 5. セットアップ（`setup.sh` は内部で OAuth2 クライアントを Hydra 管理 API に登録）
conoha server deploy <SERVER> --script setup.sh
```

setup.sh はコンテナネットワーク越しに `http://hydra:4445/admin` を叩いて OAuth2 クライアントを登録します。サーバー内部で閉じた処理のため、proxy layer の制約には影響されません。

## Agent デプロイ手順 (Claude Code etc.)

AI エージェントがこのサンプルをデプロイする場合、以下の手順を順番に実行してください。

### 手順

1. proxy 起動（まだの場合）
   ```bash
   conoha proxy boot --acme-email you@example.com <SERVER_ID>
   ```

2. アプリ初期化
   ```bash
   conoha app init <SERVER_ID> --no-input
   ```

3. アプリデプロイ（hydra-python-api ディレクトリから実行）
   ```bash
   cd <path-to>/hydra-python-api
   conoha app deploy <SERVER_ID> --no-input
   ```

4. セットアップスクリプト実行（OAuth2 クライアント登録）
   ```bash
   conoha server deploy <SERVER_ID> --script setup.sh --no-input
   ```
   - 出力から CLIENT_ID と CLIENT_SECRET をキャプチャすること

5. 動作確認（**login/consent UI のみ — 実 OAuth2 flow は subdomain split 必要**）
   - ブラウザで `https://<あなたの FQDN>/login` にアクセス → Python アプリの login 画面
   - 実 OAuth2 flow は subdomain split 後に有効化

### 注意事項
- `--no-input` と `--yes` フラグを使用すること（非 TTY 環境対応）
- setup.sh の出力にクライアント情報が含まれるので、必ずキャプチャすること
- 完全な E2E OAuth2 flow には追加作業が必要 — 上述「既知の制限」参照

## 動作確認

### 1. 認可フロー（ブラウザ）

以下の URL にアクセス（`<CLIENT_ID>` を実際の値に置き換え）:

```
http://<サーバーIP>:4444/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http://<サーバーIP>:9010/callback&scope=openid+profile+email&state=random-state-12345
```

→ ログイン画面 → 同意画面 → リダイレクト（authorization code 付き）

デモ認証: ユーザー名とパスワードに同じ値を入力（例: `admin` / `admin`）

### 2. トークン取得（curl）

```bash
# authorization code をトークンに交換
curl -X POST http://<サーバーIP>:4444/oauth2/token \
  -d grant_type=authorization_code \
  -d code=<AUTH_CODE> \
  -d redirect_uri=http://<サーバーIP>:9010/callback \
  -d client_id=<CLIENT_ID> \
  -d client_secret=<CLIENT_SECRET>
```

### 3. 保護された API

```bash
# トークンを使って API にアクセス
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  http://<サーバーIP>:9010/api/me

# 公開エンドポイント（トークン不要）
curl http://<サーバーIP>:9010/api/public
```

## API エンドポイント

| エンドポイント | 認証 | 説明 |
|--------------|------|------|
| `GET /api/me` | Bearer トークン必須 | トークンの主体・スコープ・クライアント情報を返す |
| `GET /api/public` | 不要 | 公開エンドポイント |
| `GET /callback` | 不要 | OAuth2 認可コード受信（リダイレクト先） |
| `GET /health` | 不要 | ヘルスチェック |

## カスタマイズ

- `main.py` の `login_post` を変更して実際のユーザー認証ロジックを実装
- `compose.yml` の `SECRETS_SYSTEM` を本番用の強力なシークレットに変更
- HTTPS が必要な場合は nginx リバースプロキシを前段に追加
- 本番環境では `--dev` フラグを削除し、`.env` の `SERVER_HOST` を実際のドメインに設定
