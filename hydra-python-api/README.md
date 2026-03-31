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
          └── /api/me    ← トークン検証付き API
```

1. クライアントが Hydra の認可エンドポイントにリクエスト
2. Hydra がユーザーを Python アプリのログイン画面にリダイレクト
3. ログイン成功後、Hydra が同意画面にリダイレクト
4. 同意後、Hydra がアクセストークンを発行
5. クライアントがトークンを使って `/api/me` にアクセス

## 前提条件

- conoha-cli がインストール済み
- ConoHa VPS3 アカウント
- SSH キーペア設定済み

## デプロイ

```bash
# サーバー作成（2GB以上推奨）
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# アプリ初期化
conoha app init myserver --app-name hydra

# デプロイ
conoha app deploy myserver --app-name hydra
```

## セットアップ

デプロイ後、SSH でサーバーに接続して OAuth2 クライアントを登録します:

```bash
conoha server ssh myserver

# サーバー上で実行
cd /opt/conoha/hydra
bash setup.sh
```

`client_id` と `client_secret` が表示されます。これを控えてください。

## 動作確認

### 1. 認可フロー（ブラウザ）

以下の URL にアクセス（`<CLIENT_ID>` を実際の値に置き換え）:

```
http://<サーバーIP>:4444/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http://<サーバーIP>:9010/callback&scope=openid+profile+email&state=test
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
| `GET /health` | 不要 | ヘルスチェック |

## カスタマイズ

- `main.py` の `login_post` を変更して実際のユーザー認証ロジックを実装
- `compose.yml` の `SECRETS_SYSTEM` を本番用の強力なシークレットに変更
- HTTPS が必要な場合は nginx リバースプロキシを前段に追加
- `setup.sh` の `--redirect-uri` を実際のコールバック URL に変更
- 本番環境では `--dev` フラグを削除し、`URLS_SELF_ISSUER` を実際のドメインに設定
