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

`setup.sh` が完了すると CLIENT_ID と CLIENT_SECRET が表示されます。

## ConoHa VPS デプロイ

### 前提条件

- conoha-cli がインストール・認証済み
- SSH キーペア設定済み
- セキュリティグループでポート 4444, 4445, 9010 が開放されていること

### 手順

```bash
# 1. アプリ初期化
conoha app init <SERVER> --app-name hydra-python-api

# 2. デプロイ（hydra-python-api ディレクトリから実行）
conoha app deploy <SERVER> --app-name hydra-python-api

# 3. セットアップ（IP 自動検出 + OAuth2 クライアント登録）
conoha server deploy <SERVER> --script setup.sh
```

`setup.sh` がサーバーの Public IP を自動検出し、`.env` を更新してコンテナを再起動した後、OAuth2 クライアントを登録します。

## Agent デプロイ手順 (Claude Code etc.)

AI エージェントがこのサンプルをデプロイする場合、以下の手順を順番に実行してください。

### 前提条件
- `conoha-cli` が認証済みであること
- 対象サーバーが ACTIVE 状態であること
- セキュリティグループでポート 4444, 4445, 9010 が開放されていること

### 手順

1. アプリ初期化（Docker 環境セットアップ）
   ```bash
   conoha app init <SERVER_ID> --app-name hydra-python-api --no-input
   ```

2. アプリデプロイ（hydra-python-api ディレクトリから実行）
   ```bash
   cd <path-to>/hydra-python-api
   conoha app deploy <SERVER_ID> --app-name hydra-python-api --no-input
   ```

3. セットアップスクリプト実行（IP 自動検出 + OAuth2 クライアント登録）
   ```bash
   conoha server deploy <SERVER_ID> --script setup.sh --no-input
   ```
   - `setup.sh` はサーバー上の `/opt/conoha/hydra-python-api` を自動検出して `cd` する
   - 出力から CLIENT_ID と CLIENT_SECRET をキャプチャすること

4. 動作確認
   - サーバー IP を `conoha server show <SERVER_ID>` で取得
   - ブラウザで認可 URL にアクセス:
     ```
     http://<IP>:4444/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http://<IP>:9010/callback&scope=openid+profile+email&state=random-state-12345
     ```
   - curl でトークン交換・API アクセスを確認

### 注意事項
- `--no-input` と `--yes` フラグを使用すること（非 TTY 環境対応）
- setup.sh の出力にクライアント情報が含まれるので、必ずキャプチャすること
- ポートが開放されていない場合、セキュリティグループを事前に設定すること

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
