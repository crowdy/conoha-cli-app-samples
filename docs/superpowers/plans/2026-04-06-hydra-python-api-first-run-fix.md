# hydra-python-api First-Run Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the hydra-python-api sample so it works on first run for both local (`docker compose up`) and remote (`conoha app deploy`) scenarios.

**Architecture:** Introduce a `.env` file with `SERVER_HOST=localhost` default. `compose.yml` references `${SERVER_HOST}`. `setup.sh` auto-detects IP on remote servers, updates `.env`, restarts containers, and registers the OAuth2 client.

**Tech Stack:** Docker Compose, Ory Hydra v2.2, Python/FastAPI, bash

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `hydra-python-api/.env` | Create | Default `SERVER_HOST=localhost` |
| `hydra-python-api/compose.yml` | Modify | Use `${SERVER_HOST}` variable substitution |
| `hydra-python-api/main.py` | Modify | Fix admin URL default, add `/callback` endpoint |
| `hydra-python-api/setup.sh` | Rewrite | IP detection + `.env` update + container restart + OAuth2 client registration |
| `hydra-python-api/.dockerignore` | Modify | Add `.env` |
| `hydra-python-api/README.md` | Rewrite | Fix examples, add local/remote/agent deploy instructions |

---

### Task 1: Create `.env` and update `compose.yml`

**Files:**
- Create: `hydra-python-api/.env`
- Modify: `hydra-python-api/compose.yml`

- [ ] **Step 1: Create `.env` file**

```
SERVER_HOST=localhost
```

- [ ] **Step 2: Update `compose.yml` — replace hardcoded IPs with variable**

Change the hydra service environment from:

```yaml
    environment:
      - DSN=postgres://hydra:hydra@db:5432/hydra?sslmode=disable
      - URLS_SELF_ISSUER=http://133.88.116.147:4444
      - URLS_LOGIN=http://133.88.116.147:9010/login
      - URLS_CONSENT=http://133.88.116.147:9010/consent
      - SECRETS_SYSTEM=a-very-secret-key-that-must-be-changed
      - LOG_LEVEL=info
```

To:

```yaml
    environment:
      - DSN=postgres://hydra:hydra@db:5432/hydra?sslmode=disable
      - URLS_SELF_ISSUER=http://${SERVER_HOST}:4444
      - URLS_LOGIN=http://${SERVER_HOST}:9010/login
      - URLS_CONSENT=http://${SERVER_HOST}:9010/consent
      - SECRETS_SYSTEM=a-very-secret-key-that-must-be-changed
      - LOG_LEVEL=info
```

Also change the app service environment from:

```yaml
    environment:
      - HYDRA_ADMIN_URL=http://hydra:4445/admin
```

This line is already correct (`/admin` was fixed in the current session). Keep it as is.

- [ ] **Step 3: Add `.env` to `.dockerignore`**

Add `.env` line to `hydra-python-api/.dockerignore`:

```
README.md
.git
__pycache__
*.pyc
.venv
setup.sh
.env
```

- [ ] **Step 4: Verify locally**

Run: `cd hydra-python-api && docker compose config 2>&1 | grep URLS_SELF_ISSUER`

Expected: `URLS_SELF_ISSUER=http://localhost:4444`

- [ ] **Step 5: Commit**

```bash
git add hydra-python-api/.env hydra-python-api/compose.yml hydra-python-api/.dockerignore
git commit -m "feat(hydra): use .env for SERVER_HOST instead of hardcoded IP"
```

---

### Task 2: Fix `main.py` — admin URL and callback endpoint

**Files:**
- Modify: `hydra-python-api/main.py`

- [ ] **Step 1: Fix HYDRA_ADMIN_URL default**

The current file already has the fix from this session. Verify line 20 reads:

```python
HYDRA_ADMIN_URL = os.environ.get("HYDRA_ADMIN_URL", "http://hydra:4445/admin")
```

If it still says `http://hydra:4445` (without `/admin`), change it.

- [ ] **Step 2: Verify `/callback` endpoint exists**

The current file already has the endpoint from this session. Verify lines 166-171 contain:

```python
@app.get("/callback")
async def callback(request: Request, code: str = "", error: str = "", error_description: str = "", state: str = ""):
    """OAuth2 callback — receives the authorization code or error."""
    if error:
        return JSONResponse({"error": error, "error_description": error_description}, status_code=400)
    return {"authorization_code": code, "state": state, "hint": "Exchange this code for a token via POST /oauth2/token on Hydra"}
```

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add hydra-python-api/main.py
git commit -m "fix(hydra): fix admin API path for Hydra v2 and add /callback endpoint"
```

---

### Task 3: Rewrite `setup.sh`

**Files:**
- Rewrite: `hydra-python-api/setup.sh`

- [ ] **Step 1: Write the new `setup.sh`**

```bash
#!/bin/bash
# Setup script for hydra-python-api.
# - Detects server IP (remote) or uses localhost (local)
# - Updates .env and restarts containers
# - Registers an OAuth2 client
#
# Usage:
#   Local:  cd hydra-python-api && bash setup.sh
#   Remote: conoha server deploy <SERVER_ID> --script setup.sh --no-input

set -e

# --- Locate compose directory ---
if [ -f compose.yml ]; then
  WORK_DIR="$(pwd)"
elif [ -f /opt/conoha/hydra-python-api/compose.yml ]; then
  WORK_DIR="/opt/conoha/hydra-python-api"
else
  echo "ERROR: Cannot find compose.yml. Run from project root or deploy to ConoHa first." >&2
  exit 1
fi
cd "$WORK_DIR"

# --- Detect SERVER_HOST ---
if [ -n "$SERVER_HOST" ] && [ "$SERVER_HOST" != "localhost" ]; then
  HOST="$SERVER_HOST"
  echo "==> Using provided SERVER_HOST=$HOST"
elif IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null) && [ -n "$IP" ]; then
  HOST="$IP"
  echo "==> Detected public IP: $HOST"
elif IP=$(hostname -I 2>/dev/null | awk '{print $1}') && [ -n "$IP" ]; then
  HOST="$IP"
  echo "==> Detected host IP: $HOST"
else
  HOST="localhost"
  echo "==> Could not detect IP, using localhost"
fi

# --- Update .env ---
echo "SERVER_HOST=$HOST" > .env
echo "==> Updated .env: SERVER_HOST=$HOST"

# --- Restart containers with new env ---
echo "==> Restarting containers..."
docker compose up -d

# --- Wait for Hydra to be ready ---
echo "==> Waiting for Hydra to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4444/health/ready > /dev/null 2>&1; then
    echo "==> Hydra is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Hydra did not become ready within 30 seconds." >&2
    docker compose logs hydra --tail 20
    exit 1
  fi
  sleep 1
done

# --- Register OAuth2 client ---
echo "==> Creating OAuth2 client 'demo-app'..."
docker compose exec hydra hydra create oauth2-client \
  --endpoint http://localhost:4445 \
  --name "Demo App" \
  --grant-type authorization_code,refresh_token \
  --response-type code \
  --scope openid,profile,email,offline_access \
  --redirect-uri "http://${HOST}:9010/callback" \
  --token-endpoint-auth-method client_secret_post

echo ""
echo "==> Setup complete!"
echo ""
echo "Authorization URL:"
echo "  http://${HOST}:4444/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http://${HOST}:9010/callback&scope=openid+profile+email&state=random-state-12345"
```

- [ ] **Step 2: Verify script syntax**

Run: `bash -n hydra-python-api/setup.sh`

Expected: no output (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add hydra-python-api/setup.sh
git commit -m "feat(hydra): rewrite setup.sh with IP auto-detection and container restart"
```

---

### Task 4: Rewrite `README.md`

**Files:**
- Rewrite: `hydra-python-api/README.md`

- [ ] **Step 1: Write the new README**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add hydra-python-api/README.md
git commit -m "docs(hydra): rewrite README with local/remote/agent deploy instructions"
```

---

### Task 5: Deploy and verify on remote server

**Files:** None (verification only)

- [ ] **Step 1: Destroy existing app on test server**

```bash
conoha app destroy <SERVER_ID> --app-name hydra-python-api --yes --no-input
```

- [ ] **Step 2: Re-init and deploy from scratch**

```bash
conoha app init <SERVER_ID> --app-name hydra-python-api --no-input
cd hydra-python-api
conoha app deploy <SERVER_ID> --app-name hydra-python-api --no-input
```

- [ ] **Step 3: Run setup.sh**

```bash
conoha server deploy <SERVER_ID> --script setup.sh --no-input
```

Expected output should contain:
- `Detected public IP: <ip>`
- `Updated .env: SERVER_HOST=<ip>`
- `Restarting containers...`
- `Hydra is ready.`
- `CLIENT ID` and `CLIENT SECRET` table
- Authorization URL with the detected IP

- [ ] **Step 4: Test OAuth2 flow**

Use the printed authorization URL in a browser or curl to verify the full flow works.

- [ ] **Step 5: Final commit (all changes together if not already committed)**

```bash
git add hydra-python-api/
git commit -m "fix(hydra): fix first-run experience for local and remote deploy"
```
