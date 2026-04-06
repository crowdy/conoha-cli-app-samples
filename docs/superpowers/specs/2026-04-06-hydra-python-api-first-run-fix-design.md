# hydra-python-api: First-Run Experience Fix

## Problem

The hydra-python-api sample fails on first run due to several issues:

1. **Hydra v2 Admin API path**: `main.py` calls `/oauth2/auth/requests/login` but Hydra v2 requires `/admin/` prefix. Results in 307 redirect and JSON parse error (Internal Server Error).
2. **Missing `/callback` endpoint**: `setup.sh` registers `redirect_uri` pointing to `/callback`, but no route exists in `main.py`. Results in 404 Not Found.
3. **Hardcoded localhost in `compose.yml`**: `URLS_SELF_ISSUER`, `URLS_LOGIN`, `URLS_CONSENT` use `localhost`. When deployed to a remote server, Hydra redirects the browser to `localhost`, which fails.
4. **Short `state` parameter in README**: Example uses `state=test` (4 chars), but Hydra requires at least 8 characters. Results in `invalid_state` error.

No other sample in this repository requires IP editing in `compose.yml` — hydra-python-api is unique because Hydra redirects the browser to configured URLs.

## Design

### Approach: `.env` file + auto-detect in `setup.sh`

- `.env` provides `SERVER_HOST=localhost` as default
- `compose.yml` references `${SERVER_HOST}` via Docker Compose variable substitution
- Local: `docker compose up` works without changes
- Remote: `setup.sh` auto-detects public IP, updates `.env`, restarts containers, and registers OAuth2 client

### File Changes

#### 1. New file: `.env`

```
SERVER_HOST=localhost
```

Default value enables local `docker compose up` with zero config.

#### 2. `compose.yml`

Replace hardcoded URLs with variable substitution:

```yaml
hydra:
  environment:
    - URLS_SELF_ISSUER=http://${SERVER_HOST}:4444
    - URLS_LOGIN=http://${SERVER_HOST}:9010/login
    - URLS_CONSENT=http://${SERVER_HOST}:9010/consent
```

All other services unchanged.

#### 3. `main.py`

- Fix `HYDRA_ADMIN_URL` default: `http://hydra:4445` -> `http://hydra:4445/admin`
- Add `/callback` GET endpoint: receives authorization code or error from Hydra redirect

#### 4. `setup.sh`

Rewrite to handle both local and remote scenarios:

1. Detect execution context:
   - If `SERVER_HOST` env var is set and not `localhost`, use it
   - Else try `curl -s --max-time 3 ifconfig.me`
   - Fallback to `hostname -I | awk '{print $1}'`
   - If all fail, keep `localhost`
2. Write detected IP to `.env` (`SERVER_HOST=<ip>`)
3. `docker compose up -d` to restart with new env
4. Wait for Hydra to be ready (poll `/health/ready`)
5. Register OAuth2 client with `--redirect-uri http://<ip>:9010/callback`
6. Print test URL with valid `state` parameter (8+ chars)

When run via `conoha server deploy --script`, the script executes in an arbitrary directory. The script must `cd /opt/conoha/hydra-python-api` first. When run locally, it must be executed from the project root (where `compose.yml` lives).

#### 5. `.dockerignore`

Add `.env` to prevent it from being included in the Docker image.

#### 6. `README.md`

- Fix `state=test` -> `state=random-state-12345` in all examples
- Update deploy section: use `conoha server deploy --script setup.sh` instead of SSH manual steps
- Add "Local execution" section: `docker compose up -d && bash setup.sh`
- Add `/callback` to API endpoint table
- Remove SSH-based setup instructions (replaced by deploy script)
- Add "Agent (Claude Code) deploy procedure" section with exact commands an AI agent should execute in order:

```markdown
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
   - setup.sh はサーバー上の `/opt/conoha/hydra-python-api` で実行される必要がある
   - `conoha server deploy` はスクリプトを任意ディレクトリで実行するため、
     ラッパースクリプトを作成するか setup.sh 内で cd する
   ```bash
   conoha server deploy <SERVER_ID> --script setup.sh --no-input
   ```

4. 出力から CLIENT_ID と CLIENT_SECRET を取得

5. 動作確認
   - サーバー IP を `conoha server show <SERVER_ID>` で取得
   - ブラウザで認可 URL にアクセス:
     `http://<IP>:4444/oauth2/auth?response_type=code&client_id=<CLIENT_ID>&redirect_uri=http://<IP>:9010/callback&scope=openid+profile+email&state=random-state-12345`
   - curl でトークン交換・API アクセスを確認

### 注意事項
- `--no-input` と `--yes` フラグを使用すること（非 TTY 環境対応）
- setup.sh の出力にクライアント情報が含まれるので、必ずキャプチャすること
- ポートが開放されていない場合、セキュリティグループを事前に設定すること
```

This section provides explicit, copy-pasteable steps that an agent can follow without ambiguity.

### User Flows After Changes

**Local development:**
```bash
docker compose up -d
bash setup.sh
# -> setup.sh detects localhost, registers client, prints test URL
```

**Remote deploy (conoha-cli):**
```bash
conoha app init <server> --app-name hydra-python-api
conoha app deploy <server> --app-name hydra-python-api
conoha server deploy <server> --script setup.sh
# -> setup.sh detects public IP, updates .env, restarts containers,
#    registers client, prints test URL
```

### Out of Scope

- HTTPS/TLS configuration
- Production-grade secrets management
- Custom domain support
