# dns-server サンプル設計書

GitHub Issue: [#94](https://github.com/crowdy/conoha-cli-app-samples/issues/94)
Branch: `feat/dns-server-sample`

## 概要

[ndnd.jp](https://ndnd.jp/) のような個人向けサブドメインホスティングサービスを、ConoHa VPS3 上に 1 台でセルフホストする最小サンプルを追加する。

- 自前ドメインの権威 DNS サーバー (`PowerDNS Authoritative` + `gpgsql` バックエンド) を 1 インスタンス運用
- 親 zone 配下のサブドメインと、その配下のさらにサブドメインを払い出せる (`tkim.users.example.com`, `blog.tkim.users.example.com`)
- Python 3.13 / FastAPI 製の管理 API を `curl` から叩いて CRUD する

既存サンプル `hydra-python-api` のパターン (FastAPI + PostgreSQL + 同居サービス + `accessories:` 宣言) を踏襲する。

## スコープ

本サンプルは v1 として以下を含む:

- M1: PowerDNS + PostgreSQL の compose.yml で `:53` が応答する最小構成
- M2: FastAPI で `POST/GET/PUT/DELETE /v1/subdomains` の CRUD
- M3: `conoha.yml` 整備、`conoha app deploy` 成功
- M4: README (NS 委任手順、systemd-resolved 競合対処、curl サンプル、`dig` 動作確認手順)
- M5: `tests/` 配下に validator unit + API/DNS integration

以下は本 PR の対象外 (後続候補):

- DNSSEC (`pdnsutil secure-zone` で後付け可能、README に案内のみ)
- multi-tenant 化 (per-tenant API トークン、自助登録フロー、abuse 対策)
- DNS の冗長化 (secondary NS、AXFR / NOTIFY)
- レート制限・CAPTCHA
- Python CLI クライアント

## 主要決定事項

| 項目 | 決定 | 根拠 |
|------|------|------|
| DNS エンジン | PowerDNS Authoritative 4.9 + `gpgsql` バックエンド | SQL バックエンドで Python から直接 INSERT 可能。`psql` でデバッグ容易。HTTP API ラッパー (Approach B) より実装量が少ない |
| API 統合方式 | FastAPI が PostgreSQL に直接書き込み | PowerDNS HTTP API の RRSet モデルを避け、DB スキーマ操作を 1 レイヤに集約 |
| テナンシー | Single-tenant (admin token 1 本) | サンプルとして最小スコープ。スキーマは将来の multi-tenant 化を阻害しないよう `app.api_tokens` テーブル化 |
| ドメイン基本値 | `users.example.com` (placeholder) | 既存サンプル慣行と一致。実在する `ndnd.jp` との混同を回避 |
| レコードタイプ | A / AAAA / CNAME / TXT | 個人用途の 99% カバー。MX/SRV/NS は v1 範囲外 |
| 認証 | `Authorization: Bearer <token>` (RFC 6750) | Issue #94 の `X-API-Token` を標準形式に変更。bcrypt ハッシュで DB 保存 |
| Sub-sub-domain モデル | 単一 zone 内のフラットなレコード集合 (zone 委任なし) | サンプル簡素化。子レコード関係は DB レベルで強制せず、API で情報提供のみ |
| ポート 53 公開 | `network_mode: host` で `pdns` を直結。proxy バイパス | `conoha proxy` は HTTP(S) 専用。Docker NAT (`ports:`) では UDP 53 の応答 IP が壊れるケースを回避 |
| OpenAPI | `ENV=dev` のみ `/docs` 露出 | サンプルの教育用途。prod では既定で非公開 |

## アーキテクチャ

### コンポーネント

```
                                        Internet
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  │ :53/udp,tcp             │ :443                    │
                  ▼                         ▼                         │
     ┌─────────────────────┐    ┌──────────────────────┐              │
     │ PowerDNS auth        │    │ conoha-proxy (HTTPS) │              │
     │ container: pdns      │    │ - api.example.com    │              │
     │ network_mode: host   │    └──────────┬───────────┘              │
     └────────────┬─────────┘               │                          │
                  │                          ▼                          │
                  │              ┌──────────────────────┐               │
                  │ SELECT       │ FastAPI (:8080)       │               │
                  │              │ container: app        │               │
                  │              │ Bearer token auth     │               │
                  │              └──────────┬───────────┘               │
                  │                         │ INSERT/UPDATE/DELETE      │
                  ▼                         ▼                           │
              ┌────────────────────────────────────┐                    │
              │ PostgreSQL 17                      │                    │
              │ container: db                      │                    │
              │ - PowerDNS gpgsql 標準スキーマ      │                    │
              │ - 追加スキーマ `app`                │                    │
              │ - volume: db_data                  │                    │
              └────────────────────────────────────┘                    │
                                                                        │
                                  └─────────────────────────────────────┘
```

| サービス | イメージ | 役割 | ポート |
|---------|---------|-----|-------|
| `pdns` | `powerdns/pdns-auth-49:4.9` | 権威 DNS 応答 | `53/udp`, `53/tcp` (host net) |
| `app` | 自前 build | 管理 API | `8080` (proxy 経由) |
| `db` | `postgres:17-alpine` | PowerDNS gpgsql + `app` スキーマ | `127.0.0.1:5432` (localhost のみ) |
| `pdns-init` | 自前 build (alpine + `postgresql-client` + `python3` + `py3-bcrypt`) one-shot | スキーマ適用、SOA/NS 種付け、admin token 生成 (bcrypt ハッシュ化) | — |

### conoha-cli 統合モデル

- `web:` で `app` のみ proxy 経由公開 (`api.example.com`)
- `expose:` ブロックなし (DNS は :53 で proxy 通過不可)
- `accessories: [pdns, db, pdns-init]` — blue/green 複製対象外
  - `pdns` は :53 を host で占有するため単一インスタンス必須
  - `db` は永続状態
  - `pdns-init` は one-shot
- ConoHa VPS の `ufw` または SG で `53/udp`, `53/tcp` を直接開放 (README 明記)

### ディレクトリレイアウト

```
dns-server/
├── conoha.yml
├── compose.yml
├── Dockerfile               # FastAPI app 用
├── api/
│   ├── __init__.py
│   ├── main.py              # FastAPI エントリ
│   ├── auth.py              # Bearer トークン検証
│   ├── validators.py        # name/record 検証ルール (純関数)
│   ├── db.py                # asyncpg プール + トランザクションヘルパ
│   ├── models.py            # Pydantic
│   └── routers/
│       ├── __init__.py
│       ├── health.py
│       ├── zone.py
│       └── subdomains.py
├── pdns/
│   └── pdns.conf            # gpgsql バックエンド設定
├── pdns-init/
│   ├── Dockerfile           # alpine + psql + python (bcrypt) クライアント
│   ├── entrypoint.sh        # スキーマ適用 + SOA/NS シード + token シード
│   └── schema.pgsql.sql     # PowerDNS 4.9 公式スキーマのコピー
├── examples/
│   └── curl.sh
├── tests/
│   ├── test_validators.py
│   ├── integration/
│   │   ├── test_api.py
│   │   └── test_dns.py
│   └── conftest.py
├── requirements.txt
└── README.md
```

## データモデル

### Zone 構造 (論理)

管理対象は **単一の親 zone** (`PARENT_ZONE` 環境変数で決定、既定 `users.example.com`)。

- PowerDNS `domains` テーブルにこの zone 1 行のみ
- ユーザーが作成する全サブドメイン (`tkim.users.example.com`, `blog.tkim.users.example.com`) はこの zone 内のレコード — 別 zone への委任は行わない
- Sub-sub-domain は単に長い `name` のレコード — 親子関係を DB レベルで強制しない (フラットモデル)

### PowerDNS gpgsql 標準スキーマ

`pdns-init` が PowerDNS 4.9 公式の `schema.pgsql.sql` を適用する:

| テーブル | 利用カラム | 用途 |
|---------|-----------|-----|
| `domains` | `id, name, type, account` | 親 zone (`users.example.com`) 1 行のみ |
| `records` | `id, domain_id, name, type, content, ttl, disabled, auth` | 全ユーザーレコード。挿入時に `auth=true`、`disabled=false` を必ず設定 (PowerDNS は `auth=false` を委任グルーレコードとして扱う) |
| その他 (`comments`, `domainmetadata`, `cryptokeys`, `tsigkeys`, `supermasters`) | — | v1 未使用、スキーマ上の存在のみ |

### 追加スキーマ `app`

```sql
CREATE SCHEMA app;

CREATE TABLE app.api_tokens (
    id          SERIAL PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,    -- bcrypt(raw token)
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app.audit_log (
    id          BIGSERIAL PRIMARY KEY,
    token_id    INTEGER REFERENCES app.api_tokens(id),
    action      TEXT NOT NULL,            -- 'create' | 'update' | 'delete'
    subdomain   TEXT NOT NULL,            -- e.g. 'tkim.users.example.com'
    payload     JSONB,                    -- 変更前/後の records
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `api_tokens` は v1 で 1 行のみ。テーブル化は将来の multi-tenant 化を阻害しないため
- トークンは平文保存しない (bcrypt)。`pdns-init` が `ADMIN_TOKEN` 環境変数を読み、未設定時は自動生成しコンテナログに 1 度だけ出力 (`hydra-python-api` の admin secret パターンと同一)
- `audit_log` はデバッグ用。無限増加するため README に「定期的な truncate / partition」の注意

### "Subdomain" リソース ↔ records 行のマッピング

API の `subdomain` 1 リソース = `records.name` が同一の行集合。

```
records.name             type   content              domain_id
tkim.users.example.com   A      203.0.113.42         1
tkim.users.example.com   AAAA   2001:db8::42         1
tkim.users.example.com   TXT    "v=acme1 ..."        1
                         ↑ ここまでが subdomain 1 件
```

`DELETE /v1/subdomains/tkim.users.example.com` → `name='tkim.users.example.com'` の行のみ削除。子孫 (`blog.tkim.users.example.com`) は触らない。応答 body に `orphaned_descendants: ["blog.tkim.users.example.com"]` を含めて告知のみ行う。

## API 表面

### エンドポイント一覧

| Method | Path | 認証 | 用途 |
|--------|------|-----|-----|
| `GET` | `/health` | 不要 | DB ping + PowerDNS pidfile チェック |
| `GET` | `/v1/zone` | 不要 | 親 zone メタ (name / SOA serial / NS records) |
| `GET` | `/v1/subdomains` | 必要 | 全サブドメイン一覧 (v1 はページング無し) |
| `POST` | `/v1/subdomains` | 必要 | 新規作成。既存名なら 409 |
| `GET` | `/v1/subdomains/{name}` | 必要 | 単件 + 子孫情報 |
| `PUT` | `/v1/subdomains/{name}` | 必要 | records 全量置換 (idempotent upsert) |
| `DELETE` | `/v1/subdomains/{name}` | 必要 | 削除。子孫は破壊せず情報を返すのみ |

### 認証

- `Authorization: Bearer <token>` (RFC 6750)
- 未提供 / 不正 → `401 Unauthorized`
- DB の `app.api_tokens` を bcrypt 検証
- 依存性注入で `current_token: TokenRow` を各 handler に渡す (multi-tenant 化に備える)

### Pydantic モデル (要旨)

```python
class Record(BaseModel):
    type: Literal["A", "AAAA", "CNAME", "TXT"]
    value: str
    ttl: int = Field(default=300, ge=60, le=86400)

class SubdomainCreate(BaseModel):
    name: str                                       # FQDN, must end with PARENT_ZONE
    records: list[Record] = Field(min_length=1, max_length=20)

class SubdomainResponse(BaseModel):
    name: str
    records: list[Record]
    descendants: list[str] = []                     # GET 時のみ計算
    created_at: datetime
    updated_at: datetime
```

### バリデーション (`api/validators.py`)

| ルール | 違反時 | 備考 |
|-------|-------|-----|
| `name` が `PARENT_ZONE` で終わる | `400` | env で決定 |
| `name` ラベルが RFC 1035 (1-63 文字、`[a-z0-9-]`、ハイフン先頭/末尾不可) | `400` | 全ラベル |
| 先頭ラベルが予約語 (`www`, `api`, `admin`, `mail`, `ns`, `ns1`, `ns2`, `mx`, `localhost`, `root`) | `400` | `www.users.example.com` を拒否 |
| `A` = IPv4、`AAAA` = IPv6、`CNAME` = trailing `.` 付き FQDN、`TXT` ≤ 255 byte | `400` | `ipaddress` モジュール |
| `CNAME` は同 `name` の他 type と共存不可 (RFC 1034) | `400` | A+CNAME 等 |
| 同一 (name, type, value) の重複なし | `400` | リクエスト内 + DB 内 |
| 1 subdomain あたり records ≤ 20 | `400` | min=1 |

### エラー応答 (FastAPI 標準)

```json
{ "detail": "name must end with .users.example.com" }
```

RFC 7807 Problem Details は採用しない (サンプル簡素化)。

### OpenAPI / Swagger

- `app = FastAPI(docs_url=None if PROD else "/docs")` — `ENV=dev` のみ `/docs`, `/openapi.json` 露出
- README に prod 既定で非公開である旨を記載

### curl 例 (README 抜粋)

```bash
export TOKEN=...   # コンテナログから 1 度のみ出力された値

# 作成
curl -X POST https://api.example.com/v1/subdomains \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tkim.users.example.com",
    "records": [
      {"type": "A", "value": "203.0.113.42"},
      {"type": "TXT", "value": "v=spf1 -all"}
    ]
  }'

# 子孫 (CNAME で親を指す)
curl -X POST https://api.example.com/v1/subdomains \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"blog.tkim.users.example.com","records":[{"type":"CNAME","value":"tkim.users.example.com."}]}'

# DNS 解決確認
dig @<vps-ip> tkim.users.example.com A +short
dig @<vps-ip> blog.tkim.users.example.com CNAME +short

# 削除 (子孫の存在は body で告知、ブロックはしない)
curl -X DELETE https://api.example.com/v1/subdomains/tkim.users.example.com \
  -H "Authorization: Bearer $TOKEN"
```

## 配置 / 設定

### `conoha.yml`

```yaml
name: dns-server
hosts:
  - api.example.com
web:
  service: app
  port: 8080
health:
  path: /health
  unhealthy_threshold: 24      # 120s — pdns-init / pdns 初期化待ち
# pdns / db / pdns-init は blue/green 複製対象外
accessories:
  - pdns
  - db
  - pdns-init
```

### `compose.yml` (要旨)

```yaml
services:
  app:
    build: .
    expose: ["8080"]
    environment:
      - DATABASE_URL=postgres://pdns:${POSTGRES_PASSWORD:-pdns}@db:5432/pdns
      - PARENT_ZONE=${PARENT_ZONE:-users.example.com}
      - ENV=${ENV:-prod}
    depends_on:
      pdns-init: { condition: service_completed_successfully }
      db:        { condition: service_healthy }
    restart: unless-stopped

  pdns:
    image: powerdns/pdns-auth-49:4.9
    network_mode: host        # :53 を host に直結。proxy バイパス
    volumes:
      - ./pdns/pdns.conf:/etc/powerdns/pdns.conf:ro
    depends_on:
      pdns-init: { condition: service_completed_successfully }
    restart: unless-stopped

  pdns-init:
    build: ./pdns-init
    environment:
      - DATABASE_URL=postgres://pdns:${POSTGRES_PASSWORD:-pdns}@db:5432/pdns
      - PARENT_ZONE=${PARENT_ZONE:-users.example.com}
      - PRIMARY_NS=${PRIMARY_NS:-ns1.example.com.}
      - SOA_EMAIL=${SOA_EMAIL:-admin.example.com.}
      - ADMIN_TOKEN=${ADMIN_TOKEN:-}        # 空なら entrypoint が生成しログ出力
    depends_on:
      db: { condition: service_healthy }

  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=pdns
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-pdns}
      - POSTGRES_DB=pdns
    ports:
      - "127.0.0.1:5432:5432"   # pdns(host net) → 127.0.0.1:5432。外部公開なし
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pdns"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

### `pdns/pdns.conf`

```ini
launch=gpgsql
gpgsql-host=127.0.0.1
gpgsql-port=5432
gpgsql-dbname=pdns
gpgsql-user=pdns
gpgsql-password=pdns          # POSTGRES_PASSWORD と一致させる (env 補間は pdns 側で不可、README で手順明記)
local-address=0.0.0.0
local-port=53
api=yes
api-key=changeme
webserver=yes
webserver-address=127.0.0.1
webserver-port=8081           # PowerDNS HTTP API。v1 では未使用、デバッグ用に残す
disable-axfr=yes              # zone transfer による列挙を防ぐ
log-dns-queries=no            # privacy
loglevel=4
```

### Dockerfile (FastAPI 側)

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./api/
EXPOSE 8080
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### `pdns-init/entrypoint.sh` (要旨)

```bash
#!/bin/sh
set -eu
psql "$DATABASE_URL" -f /schema.pgsql.sql
psql "$DATABASE_URL" <<SQL
  CREATE SCHEMA IF NOT EXISTS app;
  CREATE TABLE IF NOT EXISTS app.api_tokens (...);
  CREATE TABLE IF NOT EXISTS app.audit_log (...);

  INSERT INTO domains (name, type) VALUES ('${PARENT_ZONE}', 'NATIVE')
    ON CONFLICT DO NOTHING;
  INSERT INTO records (domain_id, name, type, content, ttl)
    SELECT id, '${PARENT_ZONE}', 'SOA',
      '${PRIMARY_NS} ${SOA_EMAIL} 1 10800 3600 604800 3600', 3600
    FROM domains WHERE name='${PARENT_ZONE}'
    ON CONFLICT DO NOTHING;
  INSERT INTO records (domain_id, name, type, content, ttl)
    SELECT id, '${PARENT_ZONE}', 'NS', '${PRIMARY_NS}', 3600
    FROM domains WHERE name='${PARENT_ZONE}'
    ON CONFLICT DO NOTHING;
SQL
TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 32)}"
HASH=$(python3 -c "import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt()).decode())" "$TOKEN")
psql "$DATABASE_URL" -c \
  "INSERT INTO app.api_tokens (token_hash, label) VALUES ('$HASH', 'admin') ON CONFLICT DO NOTHING;"
echo "============================================"
echo "ADMIN_TOKEN=$TOKEN"
echo "(このログは初回起動時に 1 度のみ出力されます)"
echo "============================================"
```

### 環境変数

| 変数 | 既定 | 用途 |
|-----|-----|-----|
| `PARENT_ZONE` | `users.example.com` | 管理対象 zone (デプロイ者のドメインに置換) |
| `PRIMARY_NS` | `ns1.example.com.` | SOA / NS の primary nameserver (trailing dot 必須) |
| `SOA_EMAIL` | `admin.example.com.` | SOA RNAME (DNS 形式: `@` を `.` に置換) |
| `POSTGRES_PASSWORD` | `pdns` | DB パスワード |
| `ADMIN_TOKEN` | (空) | 空なら起動時に生成しログ出力。設定済みならその値を使用 |
| `ENV` | `prod` | `dev` で `/docs` 露出 |

### ポート 53 運用ノート (README 必須項目)

1. **systemd-resolved 競合**: Ubuntu 24.04 既定で起動。`/etc/systemd/resolved.conf` に `DNSStubListener=no` を追加 → `systemctl restart systemd-resolved` → `/etc/resolv.conf` symlink を更新
2. **ファイアウォール**: `ufw allow 53/udp && ufw allow 53/tcp`
3. **NS 委任**: レジストラ側で `users.example.com` の NS レコードを VPS IP (= `ns1.example.com`) に向ける手順を明記

## エラー処理 / トランザクショナリティ

| シナリオ | 動作 |
|---------|-----|
| 複数 records INSERT 中 IntegrityError | 単一トランザクションで全ロールバック、`400` (asyncpg `async with conn.transaction()`) |
| DB ダウン | `503`、`/health` も 503 → conoha-proxy が unhealthy 判定 |
| トークン無し / 不正 | `401` (権限ではなく身元欠如のため `403` ではない) |
| `name` 検証失敗 | `400` + 違反ルールを 1 行で記述 |
| 既存 subdomain への `POST` | `409 Conflict`。`PUT` は idempotent (`200`) |
| 不在の `GET` / `DELETE` | `404` |
| `DELETE` 時に子孫存在 | `200` + `{"deleted": "...", "orphaned_descendants": [...]}`、ブロックしない |

### PowerDNS の変更ピックアップ

- gpgsql バックエンドはキャッシュ満了 (既定 10s) 後に新レコードを応答 — reload 不要
- ただし **SOA serial** はレコード変更時に手動でインクリメント (v1 では secondary 無しのため必須ではないが、`api/db.py` の `_bump_soa()` ヘルパに集約してトランザクション内で実行)

## セキュリティ / ガードレール

- API トークンは bcrypt 検証 (`api/auth.py`)
- DB ユーザー `pdns` は PowerDNS と共有 (簡素化)。`app` 専用ユーザー分離は v1 範囲外
- `disable-axfr=yes` で zone transfer を遮断 (大量列挙防止)
- API クォータ (`max_records=20`、予約語) は validators で処理

## テスト戦略

`hydra-python-api` のパターンに従う (compose.yml 上の統合テスト):

### Unit (pytest, no docker)
- `tests/test_validators.py` — name/record 検証ルールマトリクス (正常 ~6 / 異常 ~12)
- `tests/test_models.py` — Pydantic シリアライズ往復

### Integration (`docker compose up` の上で pytest)
- `tests/integration/test_api.py` — `httpx.AsyncClient` で API を叩く
  - POST 正常 → 201
  - POST PARENT_ZONE 外 → 400
  - POST 予約語 → 400
  - GET 一覧に直前作成分が含まれる
  - PUT idempotent (同 PUT 2 回 → 同結果)
  - DELETE → `orphaned_descendants` 検証
- `tests/integration/test_dns.py` — `dnspython` で `pdns:53` に直接問い合わせ
  - POST 直後 `dig tkim.users.example.com` が A を返す (キャッシュ満了まで最大 11s sleep)
  - DELETE 後 NXDOMAIN
  - CNAME loop 検出 (validator 単体)

### Smoke (手動、Issue #94 のチェックリスト)

- `conoha server add` → `g2l-t-1` で起動
- レジストラで NS を VPS に向ける手順を README に
- `conoha app deploy` 成功 (API 側)
- PowerDNS が `:53` で待機 (`dig` で SOA 取得成功)
- curl で `tkim.users.example.com` 作成 → `dig` で名前解決成功
- curl で `blog.tkim.users.example.com` を CNAME 作成 → 解決成功
- DELETE 後に NXDOMAIN
- API トークン無 / 無効で 401
- 予約語 (`www.users.example.com` 等) で 400

## ファイル責務分離

各モジュールは単一責務:

- `api/validators.py` — 純関数、IO 無し、unit test 100%
- `api/auth.py` — トークン検証のみ、DB 依存は注入
- `api/db.py` — プール + トランザクションラッパのみ、ビジネスロジック無し
- `api/routers/*.py` — HTTP ↔ DB 変換のみ、検証は validators に委譲

## 推奨フレーバー

| 項目 | 値 |
|------|---|
| Flavor | `g2l-t-1` (1GB) |
| Image  | `ubuntu-24.04` |
| 公開ポート | `53/udp`, `53/tcp`, `443` (api) |

## マイルストーン (実装順)

1. **M1 PowerDNS 起動可能化**: `compose.yml` (pdns + db + pdns-init), `pdns-init/entrypoint.sh`, `pdns/pdns.conf`, `pdns-init/schema.pgsql.sql`。SOA 取得が `dig` で成功
2. **M2 API CRUD**: `api/main.py`, `api/db.py`, `api/auth.py`, `api/validators.py`, `api/models.py`, `api/routers/*`
3. **M3 conoha-cli 統合**: `conoha.yml` 整備、`Dockerfile`、`requirements.txt`
4. **M4 README**: NS 委任手順、systemd-resolved 対処、curl サンプル、`dig` 確認手順
5. **M5 テスト**: unit (validators — 必須) + integration (API CRUD — 必須、DNS dig 検証 — 必須)。CI からは `docker compose up -d && pytest tests/` で完結させる

## 既知の制限

- **冗長化**: v1 は単一 VPS、secondary なし。本番運用は最低 2 台必要 — README に明記
- **DNSSEC**: スコープ外。後付け手順 (`pdnsutil secure-zone`) を README に案内
- **abuse 対策**: 認証トークンのみ。レート制限・CAPTCHA は v1 範囲外
- **`network_mode: host` の制約**: `pdns` コンテナは host net を使うため、Docker bridge 上の `db` を名前解決できない → `db` を `127.0.0.1:5432` に bind して host 経由で接続する。`compose.yml` のコメントで明記

## 関連

- 既存 API 系サンプル: `fastapi-ai-chatbot/`, `hydra-python-api/`
- `expose:` 規約: #54 (subdomain-split RFC)
- `conoha-cli` 最低 v0.3.0
