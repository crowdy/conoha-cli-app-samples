# dns-server Sample Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted personal DNS hosting sample (PowerDNS + Postgres + FastAPI admin API) deployable via `conoha-cli`, where `curl POST /v1/subdomains` registers subdomains under a configurable parent zone.

**Architecture:** Three-process compose stack — `pdns` (PowerDNS Authoritative 4.9, `network_mode: host` for `:53`), `db` (PostgreSQL 17 with PowerDNS gpgsql schema + `app` schema), `app` (FastAPI 0.115 with asyncpg). FastAPI writes records directly to the gpgsql tables; PowerDNS picks them up automatically (no reload). Single-tenant Bearer-token auth.

**Tech Stack:** Python 3.13, FastAPI, asyncpg, Pydantic v2, bcrypt, dnspython (tests), PowerDNS 4.9, PostgreSQL 17, Docker Compose, conoha-cli ≥ 0.3.0.

**Spec:** `docs/superpowers/specs/2026-05-07-dns-server-sample-design.md`
**Issue:** #94
**Branch:** `feat/dns-server-sample`

---

## Task 1: Bootstrap directory and tests entry point

**Files:**
- Create: `dns-server/.gitignore`
- Create: `dns-server/tests/__init__.py`
- Create: `dns-server/api/__init__.py`
- Create: `dns-server/api/routers/__init__.py`
- Create: `dns-server/tests/integration/__init__.py`

- [ ] **Step 1: Create `dns-server/.gitignore`**

```
__pycache__/
*.pyc
.pytest_cache/
.coverage
*.egg-info/
.env
.env.local
```

- [ ] **Step 2: Create empty `__init__.py` files**

```bash
mkdir -p dns-server/api/routers dns-server/tests/integration dns-server/pdns dns-server/pdns-init dns-server/examples
touch dns-server/api/__init__.py
touch dns-server/api/routers/__init__.py
touch dns-server/tests/__init__.py
touch dns-server/tests/integration/__init__.py
```

- [ ] **Step 3: Commit skeleton**

```bash
git add dns-server/
git commit -m "feat(dns-server): bootstrap directory skeleton"
```

---

## Task 2: PowerDNS init container (schema + seed + token)

**Files:**
- Create: `dns-server/pdns-init/schema.pgsql.sql`
- Create: `dns-server/pdns-init/entrypoint.sh`
- Create: `dns-server/pdns-init/Dockerfile`

- [ ] **Step 1: Create PowerDNS 4.9 gpgsql schema**

Download PowerDNS 4.9 official Postgres schema. The contents below are the verified schema — copy verbatim into `dns-server/pdns-init/schema.pgsql.sql`:

```sql
CREATE TABLE IF NOT EXISTS domains (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    master              VARCHAR(128) DEFAULT NULL,
    last_check          INT DEFAULT NULL,
    type                TEXT NOT NULL,
    notified_serial     BIGINT DEFAULT NULL,
    account             VARCHAR(40) DEFAULT NULL,
    options             TEXT DEFAULT NULL,
    catalog             TEXT DEFAULT NULL,
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE UNIQUE INDEX IF NOT EXISTS name_index ON domains(name);
CREATE INDEX IF NOT EXISTS catalog_idx ON domains(catalog);

CREATE TABLE IF NOT EXISTS records (
    id                  BIGSERIAL PRIMARY KEY,
    domain_id           INT DEFAULT NULL,
    name                VARCHAR(255) DEFAULT NULL,
    type                VARCHAR(10) DEFAULT NULL,
    content             VARCHAR(65535) DEFAULT NULL,
    ttl                 INT DEFAULT NULL,
    prio                INT DEFAULT NULL,
    disabled            BOOL DEFAULT 'f',
    ordername           VARCHAR(255),
    auth                BOOL DEFAULT 't',
    CONSTRAINT domain_exists FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE INDEX IF NOT EXISTS rec_name_index ON records(name);
CREATE INDEX IF NOT EXISTS nametype_index ON records(name, type);
CREATE INDEX IF NOT EXISTS domain_id ON records(domain_id);
CREATE INDEX IF NOT EXISTS recordorder ON records(domain_id, ordername text_pattern_ops);

CREATE TABLE IF NOT EXISTS supermasters (
    ip                  INET NOT NULL,
    nameserver          VARCHAR(255) NOT NULL,
    account             VARCHAR(40) NOT NULL,
    PRIMARY KEY(ip, nameserver)
);

CREATE TABLE IF NOT EXISTS comments (
    id                  SERIAL PRIMARY KEY,
    domain_id           INT NOT NULL,
    name                VARCHAR(255) NOT NULL,
    type                VARCHAR(10) NOT NULL,
    modified_at         INT NOT NULL,
    account             VARCHAR(40) DEFAULT NULL,
    comment             VARCHAR(65535) NOT NULL,
    CONSTRAINT domain_exists FOREIGN KEY(domain_id) REFERENCES domains(id) ON DELETE CASCADE,
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE INDEX IF NOT EXISTS comments_domain_id_idx ON comments (domain_id);
CREATE INDEX IF NOT EXISTS comments_name_type_idx ON comments (name, type);
CREATE INDEX IF NOT EXISTS comments_order_idx ON comments (domain_id, modified_at);

CREATE TABLE IF NOT EXISTS domainmetadata (
    id                  SERIAL PRIMARY KEY,
    domain_id           INT REFERENCES domains(id) ON DELETE CASCADE,
    kind                VARCHAR(32),
    content             TEXT
);
CREATE INDEX IF NOT EXISTS domainidmetaindex ON domainmetadata(domain_id);

CREATE TABLE IF NOT EXISTS cryptokeys (
    id                  SERIAL PRIMARY KEY,
    domain_id           INT REFERENCES domains(id) ON DELETE CASCADE,
    flags               INT NOT NULL,
    active              BOOL,
    published           BOOL DEFAULT TRUE,
    content             TEXT
);
CREATE INDEX IF NOT EXISTS domainidindex ON cryptokeys(domain_id);

CREATE TABLE IF NOT EXISTS tsigkeys (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255),
    algorithm           VARCHAR(50),
    secret              VARCHAR(255),
    CONSTRAINT c_lowercase_name CHECK (((name)::TEXT = LOWER((name)::TEXT)))
);
CREATE UNIQUE INDEX IF NOT EXISTS namealgoindex ON tsigkeys(name, algorithm);

-- App schema (our additions)
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.api_tokens (
    id          SERIAL PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.audit_log (
    id          BIGSERIAL PRIMARY KEY,
    token_id    INTEGER REFERENCES app.api_tokens(id),
    action      TEXT NOT NULL,
    subdomain   TEXT NOT NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_subdomain_idx ON app.audit_log (subdomain);
CREATE INDEX IF NOT EXISTS audit_created_idx ON app.audit_log (created_at DESC);
```

- [ ] **Step 2: Create init entrypoint**

Create `dns-server/pdns-init/entrypoint.sh`:

```bash
#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set}"
: "${PARENT_ZONE:?PARENT_ZONE must be set}"
: "${PRIMARY_NS:?PRIMARY_NS must be set}"
: "${SOA_EMAIL:?SOA_EMAIL must be set}"

echo "[pdns-init] applying schema"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /schema.pgsql.sql >/dev/null

echo "[pdns-init] seeding zone $PARENT_ZONE"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO domains (name, type) VALUES ('${PARENT_ZONE}', 'NATIVE')
  ON CONFLICT (name) DO NOTHING;

INSERT INTO records (domain_id, name, type, content, ttl, auth, disabled)
  SELECT id, '${PARENT_ZONE}', 'SOA',
         '${PRIMARY_NS} ${SOA_EMAIL} 1 10800 3600 604800 3600',
         3600, true, false
  FROM domains WHERE name = '${PARENT_ZONE}'
    AND NOT EXISTS (
      SELECT 1 FROM records r2
      WHERE r2.name = '${PARENT_ZONE}' AND r2.type = 'SOA'
    );

INSERT INTO records (domain_id, name, type, content, ttl, auth, disabled)
  SELECT id, '${PARENT_ZONE}', 'NS', '${PRIMARY_NS}',
         3600, true, false
  FROM domains WHERE name = '${PARENT_ZONE}'
    AND NOT EXISTS (
      SELECT 1 FROM records r2
      WHERE r2.name = '${PARENT_ZONE}' AND r2.type = 'NS'
        AND r2.content = '${PRIMARY_NS}'
    );
SQL

# Token seed: only if no token exists yet (idempotent across restarts)
EXISTING=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM app.api_tokens")
if [ "$EXISTING" -eq 0 ]; then
  TOKEN="${ADMIN_TOKEN:-$(openssl rand -hex 32)}"
  HASH=$(python3 -c "import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt()).decode())" "$TOKEN")
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
    "INSERT INTO app.api_tokens (token_hash, label) VALUES ('$HASH', 'admin');" >/dev/null
  echo "============================================"
  echo "ADMIN_TOKEN=$TOKEN"
  echo "(this line is printed only on first boot)"
  echo "============================================"
else
  echo "[pdns-init] api_tokens already populated, skipping token seed"
fi

echo "[pdns-init] done"
```

- [ ] **Step 3: Create init Dockerfile**

Create `dns-server/pdns-init/Dockerfile`:

```dockerfile
FROM alpine:3.20

RUN apk add --no-cache postgresql16-client python3 py3-bcrypt openssl

COPY schema.pgsql.sql /schema.pgsql.sql
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 4: Commit**

```bash
git add dns-server/pdns-init/
git commit -m "feat(dns-server): add pdns-init container with PowerDNS gpgsql schema and zone seed"
```

---

## Task 3: PowerDNS config + compose.yml (M1: dig SOA must succeed)

**Files:**
- Create: `dns-server/pdns/pdns.conf`
- Create: `dns-server/compose.yml`

- [ ] **Step 1: Create `dns-server/pdns/pdns.conf`**

```ini
launch=gpgsql
gpgsql-host=127.0.0.1
gpgsql-port=5432
gpgsql-dbname=pdns
gpgsql-user=pdns
gpgsql-password=pdns
local-address=0.0.0.0
local-port=53
api=yes
api-key=changeme
webserver=yes
webserver-address=127.0.0.1
webserver-port=8081
disable-axfr=yes
log-dns-queries=no
loglevel=4
```

- [ ] **Step 2: Create `dns-server/compose.yml`**

```yaml
services:
  app:
    build: .
    expose:
      - "8080"
    environment:
      - DATABASE_URL=postgres://pdns:${POSTGRES_PASSWORD:-pdns}@db:5432/pdns
      - PARENT_ZONE=${PARENT_ZONE:-users.example.com}
      - ENV=${ENV:-prod}
    depends_on:
      pdns-init:
        condition: service_completed_successfully
      db:
        condition: service_healthy
    restart: unless-stopped

  # network_mode: host so PowerDNS owns :53 directly. Side effect:
  # the host-net container can NOT resolve 'db' via Docker DNS, so
  # we point pdns.conf at 127.0.0.1:5432 and bind-publish db's port
  # to localhost only.
  pdns:
    image: powerdns/pdns-auth-49:4.9
    network_mode: host
    volumes:
      - ./pdns/pdns.conf:/etc/powerdns/pdns.conf:ro
    depends_on:
      pdns-init:
        condition: service_completed_successfully
    restart: unless-stopped

  pdns-init:
    build: ./pdns-init
    environment:
      - DATABASE_URL=postgres://pdns:${POSTGRES_PASSWORD:-pdns}@db:5432/pdns
      - PARENT_ZONE=${PARENT_ZONE:-users.example.com}
      - PRIMARY_NS=${PRIMARY_NS:-ns1.example.com.}
      - SOA_EMAIL=${SOA_EMAIL:-admin.example.com.}
      - ADMIN_TOKEN=${ADMIN_TOKEN:-}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=pdns
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-pdns}
      - POSTGRES_DB=pdns
    ports:
      # 127.0.0.1 only — pdns (host net) reaches db at localhost:5432.
      - "127.0.0.1:5432:5432"
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

- [ ] **Step 3: Smoke test PowerDNS only (no app yet)**

The `app` service won't build yet (no Dockerfile). Bring up just the DNS stack:

```bash
cd dns-server
docker compose up -d db pdns-init pdns
docker compose logs -f pdns-init
```

Expected: `pdns-init` exits 0 with `[pdns-init] done` and prints `ADMIN_TOKEN=...`.

Then verify PowerDNS responds:

```bash
dig @127.0.0.1 -p 53 users.example.com SOA +short
```

Expected: `ns1.example.com. admin.example.com. 1 10800 3600 604800 3600`

```bash
dig @127.0.0.1 -p 53 users.example.com NS +short
```

Expected: `ns1.example.com.`

Tear down:

```bash
docker compose down -v
cd ..
```

- [ ] **Step 4: Commit**

```bash
git add dns-server/pdns/ dns-server/compose.yml
git commit -m "feat(dns-server): add compose.yml and pdns.conf, M1 dig SOA succeeds"
```

---

## Task 4: FastAPI Dockerfile + requirements + minimal main.py

**Files:**
- Create: `dns-server/requirements.txt`
- Create: `dns-server/Dockerfile`
- Create: `dns-server/.dockerignore`
- Create: `dns-server/api/main.py`

- [ ] **Step 1: Create `dns-server/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
asyncpg==0.29.0
bcrypt==4.2.0
pydantic==2.9.2
```

- [ ] **Step 2: Create `dns-server/Dockerfile`**

```dockerfile
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/

EXPOSE 8080

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 3: Create `dns-server/.dockerignore`**

```
__pycache__/
*.pyc
.pytest_cache/
tests/
.coverage
.env
.env.local
*.md
```

- [ ] **Step 4: Create minimal `dns-server/api/main.py`**

```python
"""FastAPI app for the dns-server sample.

Routers are mounted in Task 8 once they exist.
"""

import os

from fastapi import FastAPI

ENV = os.environ.get("ENV", "prod")

app = FastAPI(
    title="dns-server admin API",
    version="0.1.0",
    docs_url="/docs" if ENV == "dev" else None,
    openapi_url="/openapi.json" if ENV == "dev" else None,
)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "dns-server", "version": "0.1.0"}
```

- [ ] **Step 5: Build the image to confirm it compiles**

```bash
cd dns-server
docker compose build app
cd ..
```

Expected: Build succeeds, no errors.

- [ ] **Step 6: Commit**

```bash
git add dns-server/Dockerfile dns-server/.dockerignore dns-server/requirements.txt dns-server/api/main.py
git commit -m "feat(dns-server): scaffold FastAPI app with Dockerfile and requirements"
```

---

## Task 5: Validators (TDD — pure functions, full unit coverage)

**Files:**
- Create: `dns-server/pyproject.toml`
- Create: `dns-server/tests/test_validators.py`
- Create: `dns-server/api/validators.py`

- [ ] **Step 0: Create `dns-server/pyproject.toml`** so pytest can resolve `api.*` imports

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
pythonpath = ["."]
```

- [ ] **Step 1: Write failing tests for `validate_name`**

Create `dns-server/tests/test_validators.py`:

```python
import pytest

from api.validators import (
    ValidationError,
    validate_name,
    validate_record,
    validate_records_set,
)

PARENT = "users.example.com"


class TestValidateName:
    def test_simple_subdomain(self):
        validate_name("tkim.users.example.com", PARENT)

    def test_nested_subdomain(self):
        validate_name("blog.tkim.users.example.com", PARENT)

    def test_uppercase_normalized_lowercase(self):
        validate_name("TKim.Users.Example.Com", PARENT)

    def test_must_end_with_parent_zone(self):
        with pytest.raises(ValidationError, match="must end with"):
            validate_name("tkim.example.com", PARENT)

    def test_cannot_equal_parent(self):
        with pytest.raises(ValidationError, match="cannot equal"):
            validate_name("users.example.com", PARENT)

    def test_reserved_label_www(self):
        with pytest.raises(ValidationError, match="reserved"):
            validate_name("www.users.example.com", PARENT)

    def test_reserved_label_admin(self):
        with pytest.raises(ValidationError, match="reserved"):
            validate_name("admin.users.example.com", PARENT)

    def test_label_too_long(self):
        long_label = "a" * 64
        with pytest.raises(ValidationError, match="label"):
            validate_name(f"{long_label}.users.example.com", PARENT)

    def test_label_with_invalid_char(self):
        with pytest.raises(ValidationError, match="label"):
            validate_name("tk_im.users.example.com", PARENT)

    def test_label_starts_with_hyphen(self):
        with pytest.raises(ValidationError, match="label"):
            validate_name("-tkim.users.example.com", PARENT)
```

- [ ] **Step 2: Run tests, expect failures**

```bash
cd dns-server
python -m pytest tests/test_validators.py -v
cd ..
```

Expected: All tests fail with `ModuleNotFoundError: No module named 'api.validators'`.

- [ ] **Step 3: Add tests for `validate_record`**

Append to `dns-server/tests/test_validators.py`:

```python
class TestValidateRecord:
    def test_a_record_valid(self):
        validate_record({"type": "A", "value": "203.0.113.42", "ttl": 300})

    def test_a_record_invalid_ipv4(self):
        with pytest.raises(ValidationError, match="IPv4"):
            validate_record({"type": "A", "value": "not-an-ip", "ttl": 300})

    def test_a_record_rejects_ipv6(self):
        with pytest.raises(ValidationError, match="IPv4"):
            validate_record({"type": "A", "value": "2001:db8::1", "ttl": 300})

    def test_aaaa_record_valid(self):
        validate_record({"type": "AAAA", "value": "2001:db8::42", "ttl": 300})

    def test_aaaa_record_rejects_ipv4(self):
        with pytest.raises(ValidationError, match="IPv6"):
            validate_record({"type": "AAAA", "value": "203.0.113.42", "ttl": 300})

    def test_cname_record_valid_with_trailing_dot(self):
        validate_record({"type": "CNAME", "value": "tkim.users.example.com.", "ttl": 300})

    def test_cname_record_requires_trailing_dot(self):
        with pytest.raises(ValidationError, match="trailing dot"):
            validate_record({"type": "CNAME", "value": "tkim.users.example.com", "ttl": 300})

    def test_txt_record_valid(self):
        validate_record({"type": "TXT", "value": "v=spf1 -all", "ttl": 300})

    def test_txt_record_too_long(self):
        with pytest.raises(ValidationError, match="255"):
            validate_record({"type": "TXT", "value": "a" * 256, "ttl": 300})


class TestValidateRecordsSet:
    def test_multiple_a_records_allowed(self):
        validate_records_set([
            {"type": "A", "value": "203.0.113.1", "ttl": 300},
            {"type": "A", "value": "203.0.113.2", "ttl": 300},
        ])

    def test_duplicate_record_rejected(self):
        with pytest.raises(ValidationError, match="duplicate"):
            validate_records_set([
                {"type": "A", "value": "203.0.113.1", "ttl": 300},
                {"type": "A", "value": "203.0.113.1", "ttl": 300},
            ])

    def test_cname_alone_allowed(self):
        validate_records_set([
            {"type": "CNAME", "value": "tkim.users.example.com.", "ttl": 300},
        ])

    def test_cname_with_other_type_rejected(self):
        with pytest.raises(ValidationError, match="CNAME"):
            validate_records_set([
                {"type": "CNAME", "value": "tkim.users.example.com.", "ttl": 300},
                {"type": "A", "value": "203.0.113.1", "ttl": 300},
            ])
```

- [ ] **Step 4: Implement `validators.py`**

Create `dns-server/api/validators.py`:

```python
"""Pure-function validators for the dns-server admin API.

These functions raise ValidationError on policy violations. They have
no IO and are exercised by the unit test suite (tests/test_validators.py).
"""

from __future__ import annotations

import ipaddress
import re
from typing import Iterable

LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")

RESERVED_LABELS = frozenset({
    "www", "api", "admin", "mail", "ns", "ns1", "ns2", "mx",
    "localhost", "root",
})

ALLOWED_TYPES = frozenset({"A", "AAAA", "CNAME", "TXT"})


class ValidationError(ValueError):
    """Raised when a name or record fails policy."""


def validate_name(name: str, parent_zone: str) -> str:
    """Return the lowercase canonical form, or raise ValidationError."""
    canonical = name.strip().lower().rstrip(".")
    parent = parent_zone.strip().lower().rstrip(".")

    if canonical == parent:
        raise ValidationError(f"name cannot equal parent zone {parent}")
    if not canonical.endswith("." + parent):
        raise ValidationError(f"name must end with .{parent}")

    own_part = canonical[: -(len(parent) + 1)]  # strip ".<parent>"
    labels = own_part.split(".")
    if not labels or labels == [""]:
        raise ValidationError("name has no labels above the parent zone")

    for label in labels:
        if not LABEL_RE.match(label):
            raise ValidationError(
                f"label '{label}' is invalid (1-63 chars, [a-z0-9-], "
                "no leading/trailing hyphen)"
            )
    if labels[0] in RESERVED_LABELS:
        raise ValidationError(f"first label '{labels[0]}' is reserved")

    return canonical


def validate_record(record: dict) -> None:
    rtype = record.get("type")
    value = record.get("value", "")
    if rtype not in ALLOWED_TYPES:
        raise ValidationError(f"type {rtype} not in {sorted(ALLOWED_TYPES)}")

    if rtype == "A":
        try:
            ipaddress.IPv4Address(value)
        except (ipaddress.AddressValueError, ValueError) as e:
            raise ValidationError(f"A record value must be IPv4: {e}")
    elif rtype == "AAAA":
        try:
            ipaddress.IPv6Address(value)
        except (ipaddress.AddressValueError, ValueError) as e:
            raise ValidationError(f"AAAA record value must be IPv6: {e}")
    elif rtype == "CNAME":
        if not value.endswith("."):
            raise ValidationError("CNAME value must have trailing dot (FQDN)")
    elif rtype == "TXT":
        if len(value.encode("utf-8")) > 255:
            raise ValidationError("TXT value exceeds 255 bytes")


def validate_records_set(records: Iterable[dict]) -> None:
    records = list(records)
    types = {r["type"] for r in records}
    if "CNAME" in types and len(types) > 1:
        raise ValidationError("CNAME cannot coexist with other record types")

    seen: set[tuple[str, str]] = set()
    for r in records:
        validate_record(r)
        key = (r["type"], r["value"])
        if key in seen:
            raise ValidationError(f"duplicate record {key}")
        seen.add(key)
```

- [ ] **Step 5: Run tests, expect all pass**

```bash
cd dns-server
python -m pip install pytest
python -m pytest tests/test_validators.py -v
cd ..
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add dns-server/pyproject.toml dns-server/api/validators.py dns-server/tests/test_validators.py
git commit -m "feat(dns-server): add validators with full unit coverage"
```

---

## Task 6: Pydantic models + asyncpg DB layer

**Files:**
- Create: `dns-server/api/models.py`
- Create: `dns-server/api/db.py`

- [ ] **Step 1: Create `dns-server/api/models.py`**

```python
"""Pydantic v2 request/response models."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Record(BaseModel):
    type: Literal["A", "AAAA", "CNAME", "TXT"]
    value: str
    ttl: int = Field(default=300, ge=60, le=86400)


class SubdomainCreate(BaseModel):
    name: str
    records: list[Record] = Field(min_length=1, max_length=20)


class SubdomainUpdate(BaseModel):
    records: list[Record] = Field(min_length=1, max_length=20)


class SubdomainResponse(BaseModel):
    name: str
    records: list[Record]
    descendants: list[str] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DeleteResponse(BaseModel):
    deleted: str
    orphaned_descendants: list[str] = []


class ZoneInfo(BaseModel):
    name: str
    soa_serial: int
    nameservers: list[str]
```

- [ ] **Step 2: Create `dns-server/api/db.py`**

```python
"""asyncpg connection pool + transactional helpers.

This module owns the database lifecycle and exposes small helpers to the
routers. It does NOT contain business logic — validation lives in
validators.py and HTTP shape lives in routers/.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg
from fastapi import FastAPI

DATABASE_URL = os.environ["DATABASE_URL"] if "DATABASE_URL" in os.environ else None
PARENT_ZONE = os.environ.get("PARENT_ZONE", "users.example.com").lower().rstrip(".")

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL must be set")
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("pool not initialised")
    return _pool


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await init_pool()
    try:
        yield
    finally:
        await close_pool()


# ---- domain helpers ----

async def get_parent_domain_id(conn: asyncpg.Connection) -> int:
    row = await conn.fetchrow(
        "SELECT id FROM domains WHERE name = $1", PARENT_ZONE
    )
    if row is None:
        raise RuntimeError(
            f"parent zone {PARENT_ZONE} not seeded — pdns-init must run first"
        )
    return row["id"]


async def bump_soa(conn: asyncpg.Connection, domain_id: int) -> None:
    """Increment SOA serial. Called within a write transaction."""
    soa = await conn.fetchrow(
        "SELECT id, content FROM records WHERE domain_id = $1 AND type = 'SOA'",
        domain_id,
    )
    if soa is None:
        return
    parts = soa["content"].split()
    if len(parts) >= 7:
        try:
            parts[2] = str(int(parts[2]) + 1)
            new_content = " ".join(parts)
            await conn.execute(
                "UPDATE records SET content = $1 WHERE id = $2",
                new_content,
                soa["id"],
            )
        except ValueError:
            pass
```

- [ ] **Step 3: Commit**

```bash
git add dns-server/api/models.py dns-server/api/db.py
git commit -m "feat(dns-server): add Pydantic models and asyncpg pool helpers"
```

---

## Task 7: Bearer token authentication (TDD with mocked DB)

**Files:**
- Create: `dns-server/tests/test_auth.py`
- Create: `dns-server/api/auth.py`

- [ ] **Step 1: Write failing tests**

Create `dns-server/tests/test_auth.py`:

```python
"""Auth tests using bcrypt against an in-memory token store."""

import bcrypt
import pytest

from api.auth import verify_token, AuthError


def _hash(token: str) -> str:
    return bcrypt.hashpw(token.encode(), bcrypt.gensalt()).decode()


class _FakeStore:
    def __init__(self, rows):
        self._rows = rows

    async def fetch_all(self):
        return self._rows


@pytest.mark.asyncio
async def test_verify_token_returns_id_for_valid():
    store = _FakeStore([{"id": 1, "token_hash": _hash("secret")}])
    token_id = await verify_token("secret", store)
    assert token_id == 1


@pytest.mark.asyncio
async def test_verify_token_raises_on_unknown():
    store = _FakeStore([{"id": 1, "token_hash": _hash("secret")}])
    with pytest.raises(AuthError):
        await verify_token("wrong", store)


@pytest.mark.asyncio
async def test_verify_token_raises_on_empty_store():
    store = _FakeStore([])
    with pytest.raises(AuthError):
        await verify_token("anything", store)
```

- [ ] **Step 2: Add pytest-asyncio + httpx to requirements**

Edit `dns-server/requirements.txt` — append:

```
pytest==8.3.3
pytest-asyncio==0.24.0
httpx==0.27.2
```

(`httpx` will be needed by integration tests in later tasks; bundling now.) `pyproject.toml` with `asyncio_mode = "auto"` was already created in Task 5 — no change needed there.

- [ ] **Step 3: Run failing test**

```bash
cd dns-server
python -m pip install -r requirements.txt
python -m pytest tests/test_auth.py -v
cd ..
```

Expected: All fail with `ModuleNotFoundError: No module named 'api.auth'`.

- [ ] **Step 4: Implement `dns-server/api/auth.py`**

```python
"""Bearer token authentication.

The store interface is abstract so tests can swap a fake implementation
without touching the database. The production store reads from
app.api_tokens via asyncpg.
"""

from __future__ import annotations

from typing import Any, Protocol

import bcrypt
from fastapi import Depends, Header, HTTPException, status

from api.db import pool


class AuthError(Exception):
    pass


class TokenStore(Protocol):
    async def fetch_all(self) -> list[dict[str, Any]]: ...


class PgTokenStore:
    async def fetch_all(self) -> list[dict[str, Any]]:
        async with pool().acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, token_hash FROM app.api_tokens"
            )
            return [dict(r) for r in rows]


async def verify_token(raw: str, store: TokenStore) -> int:
    rows = await store.fetch_all()
    for row in rows:
        if bcrypt.checkpw(raw.encode(), row["token_hash"].encode()):
            return row["id"]
    raise AuthError("token not recognised")


async def require_token(
    authorization: str | None = Header(default=None),
) -> int:
    """FastAPI dependency. Returns token_id, or raises 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing Bearer token",
        )
    raw = authorization.split(None, 1)[1].strip()
    try:
        return await verify_token(raw, PgTokenStore())
    except AuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
        )
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd dns-server
python -m pytest tests/test_auth.py -v
cd ..
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add dns-server/api/auth.py dns-server/tests/test_auth.py dns-server/requirements.txt
git commit -m "feat(dns-server): add Bearer token auth with bcrypt and unit tests"
```

---

## Task 8: Health and zone routers; mount in main.py

**Files:**
- Create: `dns-server/api/routers/health.py`
- Create: `dns-server/api/routers/zone.py`
- Modify: `dns-server/api/main.py`

- [ ] **Step 1: Create `dns-server/api/routers/health.py`**

```python
"""Liveness/readiness check.

Returns 200 only if the DB is reachable.
"""

from fastapi import APIRouter, HTTPException, status

from api.db import pool

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    try:
        async with pool().acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception as exc:  # asyncpg raises a wide set of types
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"db unreachable: {exc.__class__.__name__}",
        )
    return {"status": "ok"}
```

- [ ] **Step 2: Create `dns-server/api/routers/zone.py`**

```python
"""Parent zone introspection (no auth — public meta)."""

from fastapi import APIRouter, HTTPException, status

from api.db import PARENT_ZONE, get_parent_domain_id, pool
from api.models import ZoneInfo

router = APIRouter(tags=["zone"])


@router.get("/v1/zone", response_model=ZoneInfo)
async def get_zone() -> ZoneInfo:
    async with pool().acquire() as conn:
        try:
            domain_id = await get_parent_domain_id(conn)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            )

        soa_row = await conn.fetchrow(
            "SELECT content FROM records WHERE domain_id = $1 AND type = 'SOA'",
            domain_id,
        )
        ns_rows = await conn.fetch(
            "SELECT content FROM records WHERE domain_id = $1 AND type = 'NS'",
            domain_id,
        )

    soa_serial = 0
    if soa_row is not None:
        parts = soa_row["content"].split()
        if len(parts) >= 7:
            try:
                soa_serial = int(parts[2])
            except ValueError:
                soa_serial = 0

    return ZoneInfo(
        name=PARENT_ZONE,
        soa_serial=soa_serial,
        nameservers=[r["content"] for r in ns_rows],
    )
```

- [ ] **Step 3: Update `dns-server/api/main.py` to mount routers and lifespan**

Replace `dns-server/api/main.py` entirely:

```python
"""FastAPI app for the dns-server sample."""

import os

from fastapi import FastAPI

from api.db import lifespan
from api.routers import health, zone

ENV = os.environ.get("ENV", "prod")

app = FastAPI(
    title="dns-server admin API",
    version="0.1.0",
    docs_url="/docs" if ENV == "dev" else None,
    openapi_url="/openapi.json" if ENV == "dev" else None,
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(zone.router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "dns-server", "version": "0.1.0"}
```

- [ ] **Step 4: Smoke-test the full stack end-to-end**

```bash
cd dns-server
docker compose up -d --build
docker compose logs -f pdns-init  # capture ADMIN_TOKEN
```

In another shell (and capture the printed token):

```bash
curl -i http://127.0.0.1:8080/  # via docker network → won't work without published port
```

The `app` service has only `expose: 8080` (no host publish — proxy handles in prod). For local smoke, temporarily forward:

```bash
docker compose exec app curl -fsS http://localhost:8080/health
docker compose exec app curl -fsS http://localhost:8080/v1/zone
```

Expected: `/health` returns `{"status":"ok"}`. `/v1/zone` returns `{"name":"users.example.com","soa_serial":1,"nameservers":["ns1.example.com."]}`.

Tear down:

```bash
docker compose down -v
cd ..
```

- [ ] **Step 5: Commit**

```bash
git add dns-server/api/main.py dns-server/api/routers/health.py dns-server/api/routers/zone.py
git commit -m "feat(dns-server): add /health and /v1/zone routers, mount lifespan"
```

---

## Task 9: Integration test harness + POST /v1/subdomains (TDD)

**Files:**
- Create: `dns-server/compose.test.yml`
- Create: `dns-server/tests/conftest.py`
- Create: `dns-server/tests/integration/test_api.py`
- Create: `dns-server/api/routers/subdomains.py`
- Modify: `dns-server/api/main.py` (mount subdomains router)

- [ ] **Step 1: Create `dns-server/compose.test.yml`**

Test override that publishes the API port and uses a fixed admin token:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      - ENV=dev
  pdns-init:
    environment:
      - ADMIN_TOKEN=test-admin-token
```

- [ ] **Step 2: Create `dns-server/tests/conftest.py`**

```python
"""Pytest fixtures for the dns-server integration suite.

Assumes `docker compose -f compose.yml -f compose.test.yml up -d` is
already running. Tests poll /health and the DNS port until ready, then
talk to the running stack.
"""

from __future__ import annotations

import asyncio
import os

import asyncpg
import httpx
import pytest

API_BASE = os.environ.get("DNS_API_BASE", "http://127.0.0.1:8080")
DB_URL = os.environ.get("DNS_TEST_DB", "postgres://pdns:pdns@127.0.0.1:5432/pdns")
ADMIN_TOKEN = os.environ.get("DNS_ADMIN_TOKEN", "test-admin-token")
PARENT_ZONE = "users.example.com"


@pytest.fixture(scope="session")
async def wait_ready():
    deadline = asyncio.get_event_loop().time() + 60
    async with httpx.AsyncClient() as client:
        while asyncio.get_event_loop().time() < deadline:
            try:
                resp = await client.get(f"{API_BASE}/health", timeout=2)
                if resp.status_code == 200:
                    return
            except Exception:
                pass
            await asyncio.sleep(1)
    raise RuntimeError(f"API not ready at {API_BASE}")


@pytest.fixture
async def client(wait_ready):
    async with httpx.AsyncClient(base_url=API_BASE, timeout=10) as c:
        yield c


@pytest.fixture
def auth_headers():
    return {"Authorization": f"Bearer {ADMIN_TOKEN}"}


@pytest.fixture(autouse=True)
async def clean_records(wait_ready):
    """Wipe all records except SOA/NS for the parent zone before each test."""
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute(
            """
            DELETE FROM records r
            USING domains d
            WHERE r.domain_id = d.id
              AND d.name = $1
              AND r.type NOT IN ('SOA', 'NS')
            """,
            PARENT_ZONE,
        )
    finally:
        await conn.close()
    yield
```

- [ ] **Step 3: Write failing test for POST /v1/subdomains**

Create `dns-server/tests/integration/test_api.py`:

```python
"""End-to-end API tests against a running compose stack."""

import pytest


class TestPostSubdomain:
    async def test_create_simple_a_record(self, client, auth_headers):
        resp = await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["name"] == "tkim.users.example.com"
        assert body["records"] == [
            {"type": "A", "value": "203.0.113.42", "ttl": 300}
        ]

    async def test_rejects_outside_parent_zone(self, client, auth_headers):
        resp = await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 400
        assert "must end with" in resp.json()["detail"]

    async def test_rejects_reserved_label(self, client, auth_headers):
        resp = await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "www.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 400
        assert "reserved" in resp.json()["detail"]

    async def test_missing_token_returns_401(self, client):
        resp = await client.post(
            "/v1/subdomains",
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 401

    async def test_duplicate_post_returns_409(self, client, auth_headers):
        payload = {
            "name": "tkim.users.example.com",
            "records": [{"type": "A", "value": "203.0.113.42"}],
        }
        first = await client.post("/v1/subdomains", headers=auth_headers, json=payload)
        assert first.status_code == 201
        dup = await client.post("/v1/subdomains", headers=auth_headers, json=payload)
        assert dup.status_code == 409
```

- [ ] **Step 4: Bring up the test stack and run failing tests**

```bash
cd dns-server
docker compose -f compose.yml -f compose.test.yml up -d --build
python -m pytest tests/integration/test_api.py -v
```

Expected: All fail with 404 (router not mounted yet).

- [ ] **Step 5: Implement `dns-server/api/routers/subdomains.py` (POST only for now)**

```python
"""Subdomain CRUD.

Each "subdomain" maps to all rows in PowerDNS `records` sharing the same
`name`. Writes go through a single transaction that bumps the SOA serial.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from api.auth import require_token
from api.db import PARENT_ZONE, bump_soa, get_parent_domain_id, pool
from api.models import Record, SubdomainCreate, SubdomainResponse
from api.validators import ValidationError, validate_name, validate_records_set

router = APIRouter(prefix="/v1/subdomains", tags=["subdomains"])


def _err400(msg: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)


@router.post("", response_model=SubdomainResponse, status_code=status.HTTP_201_CREATED)
async def create_subdomain(
    payload: SubdomainCreate,
    token_id: int = Depends(require_token),
) -> SubdomainResponse:
    try:
        canonical = validate_name(payload.name, PARENT_ZONE)
        validate_records_set([r.model_dump() for r in payload.records])
    except ValidationError as exc:
        raise _err400(str(exc))

    async with pool().acquire() as conn:
        async with conn.transaction():
            domain_id = await get_parent_domain_id(conn)

            existing = await conn.fetchval(
                "SELECT count(*) FROM records WHERE domain_id = $1 AND name = $2",
                domain_id,
                canonical,
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"subdomain {canonical} already exists",
                )

            for r in payload.records:
                await conn.execute(
                    """
                    INSERT INTO records (domain_id, name, type, content, ttl, auth, disabled)
                    VALUES ($1, $2, $3, $4, $5, true, false)
                    """,
                    domain_id,
                    canonical,
                    r.type,
                    r.value,
                    r.ttl,
                )

            await bump_soa(conn, domain_id)

            await conn.execute(
                """
                INSERT INTO app.audit_log (token_id, action, subdomain, payload)
                VALUES ($1, 'create', $2, $3::jsonb)
                """,
                token_id,
                canonical,
                _records_json(payload.records),
            )

    now = datetime.now(timezone.utc)
    return SubdomainResponse(
        name=canonical,
        records=payload.records,
        descendants=[],
        created_at=now,
        updated_at=now,
    )


def _records_json(records: list[Record]) -> str:
    import json

    return json.dumps([r.model_dump() for r in records])
```

- [ ] **Step 6: Mount the subdomains router in `api/main.py`**

Edit `dns-server/api/main.py` — replace the imports and `include_router` block:

```python
from api.routers import health, subdomains, zone
```

```python
app.include_router(health.router)
app.include_router(zone.router)
app.include_router(subdomains.router)
```

- [ ] **Step 7: Rebuild and re-run tests**

```bash
docker compose -f compose.yml -f compose.test.yml up -d --build
python -m pytest tests/integration/test_api.py -v
cd ..
```

Expected: All POST tests pass.

- [ ] **Step 8: Commit**

```bash
git add dns-server/compose.test.yml dns-server/tests/conftest.py dns-server/tests/integration/test_api.py dns-server/api/routers/subdomains.py dns-server/api/main.py
git commit -m "feat(dns-server): POST /v1/subdomains with validation and audit log"
```

---

## Task 10: GET /v1/subdomains (list and single)

**Files:**
- Modify: `dns-server/api/routers/subdomains.py`
- Modify: `dns-server/tests/integration/test_api.py`

- [ ] **Step 1: Add tests**

Append to `dns-server/tests/integration/test_api.py`:

```python
class TestGetSubdomain:
    async def test_list_includes_created(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        resp = await client.get("/v1/subdomains", headers=auth_headers)
        assert resp.status_code == 200
        names = [s["name"] for s in resp.json()]
        assert "tkim.users.example.com" in names

    async def test_get_single_returns_records_and_descendants(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "blog.tkim.users.example.com",
                "records": [{"type": "CNAME", "value": "tkim.users.example.com."}],
            },
        )
        resp = await client.get(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "tkim.users.example.com"
        assert "blog.tkim.users.example.com" in body["descendants"]

    async def test_get_unknown_returns_404(self, client, auth_headers):
        resp = await client.get(
            "/v1/subdomains/nope.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 404
```

- [ ] **Step 2: Run, expect failures (404 for /v1/subdomains list — not implemented)**

```bash
cd dns-server
python -m pytest tests/integration/test_api.py::TestGetSubdomain -v
cd ..
```

Expected: Failures with 404 / 405.

- [ ] **Step 3: Implement GET handlers**

Append to `dns-server/api/routers/subdomains.py`:

```python
@router.get("", response_model=list[SubdomainResponse])
async def list_subdomains(
    token_id: int = Depends(require_token),
) -> list[SubdomainResponse]:
    async with pool().acquire() as conn:
        domain_id = await get_parent_domain_id(conn)
        rows = await conn.fetch(
            """
            SELECT name, type, content, ttl
            FROM records
            WHERE domain_id = $1
              AND type NOT IN ('SOA', 'NS')
              AND name <> $2
            ORDER BY name, type, content
            """,
            domain_id,
            PARENT_ZONE,
        )

    grouped: dict[str, list[Record]] = {}
    for row in rows:
        grouped.setdefault(row["name"], []).append(
            Record(type=row["type"], value=row["content"], ttl=row["ttl"])
        )
    return [
        SubdomainResponse(name=name, records=records)
        for name, records in grouped.items()
    ]


@router.get("/{name}", response_model=SubdomainResponse)
async def get_subdomain(
    name: str,
    token_id: int = Depends(require_token),
) -> SubdomainResponse:
    try:
        canonical = validate_name(name, PARENT_ZONE)
    except ValidationError as exc:
        raise _err400(str(exc))

    async with pool().acquire() as conn:
        domain_id = await get_parent_domain_id(conn)

        rows = await conn.fetch(
            """
            SELECT type, content, ttl FROM records
            WHERE domain_id = $1 AND name = $2
            ORDER BY type, content
            """,
            domain_id,
            canonical,
        )
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"subdomain {canonical} not found",
            )

        descendant_rows = await conn.fetch(
            """
            SELECT DISTINCT name FROM records
            WHERE domain_id = $1
              AND name LIKE '%.' || $2
              AND type NOT IN ('SOA', 'NS')
            ORDER BY name
            """,
            domain_id,
            canonical,
        )

    return SubdomainResponse(
        name=canonical,
        records=[
            Record(type=r["type"], value=r["content"], ttl=r["ttl"]) for r in rows
        ],
        descendants=[r["name"] for r in descendant_rows],
    )
```

- [ ] **Step 4: Rebuild and re-run**

```bash
cd dns-server
docker compose -f compose.yml -f compose.test.yml up -d --build app
python -m pytest tests/integration/test_api.py::TestGetSubdomain -v
cd ..
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add dns-server/api/routers/subdomains.py dns-server/tests/integration/test_api.py
git commit -m "feat(dns-server): GET /v1/subdomains list and single with descendant info"
```

---

## Task 11: PUT /v1/subdomains/{name} (idempotent replace)

**Files:**
- Modify: `dns-server/api/routers/subdomains.py`
- Modify: `dns-server/tests/integration/test_api.py`

- [ ] **Step 1: Add tests**

Append to `dns-server/tests/integration/test_api.py`:

```python
class TestPutSubdomain:
    async def test_put_replaces_records(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.1"}],
            },
        )
        resp = await client.put(
            "/v1/subdomains/tkim.users.example.com",
            headers=auth_headers,
            json={"records": [{"type": "A", "value": "203.0.113.2"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["records"] == [
            {"type": "A", "value": "203.0.113.2", "ttl": 300}
        ]

    async def test_put_is_idempotent(self, client, auth_headers):
        body = {"records": [{"type": "A", "value": "203.0.113.7"}]}
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": body["records"],
            },
        )
        first = await client.put(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers, json=body
        )
        second = await client.put(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers, json=body
        )
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["records"] == second.json()["records"]

    async def test_put_creates_if_absent(self, client, auth_headers):
        resp = await client.put(
            "/v1/subdomains/tkim.users.example.com",
            headers=auth_headers,
            json={"records": [{"type": "A", "value": "203.0.113.42"}]},
        )
        assert resp.status_code == 200
```

- [ ] **Step 2: Run, expect failures**

```bash
cd dns-server
python -m pytest tests/integration/test_api.py::TestPutSubdomain -v
cd ..
```

Expected: 405 / 404.

- [ ] **Step 3: Implement PUT**

Append to `dns-server/api/routers/subdomains.py`:

```python
from api.models import SubdomainUpdate  # add at top with other imports


@router.put("/{name}", response_model=SubdomainResponse)
async def put_subdomain(
    name: str,
    payload: SubdomainUpdate,
    token_id: int = Depends(require_token),
) -> SubdomainResponse:
    try:
        canonical = validate_name(name, PARENT_ZONE)
        validate_records_set([r.model_dump() for r in payload.records])
    except ValidationError as exc:
        raise _err400(str(exc))

    async with pool().acquire() as conn:
        async with conn.transaction():
            domain_id = await get_parent_domain_id(conn)

            await conn.execute(
                "DELETE FROM records WHERE domain_id = $1 AND name = $2",
                domain_id,
                canonical,
            )
            for r in payload.records:
                await conn.execute(
                    """
                    INSERT INTO records (domain_id, name, type, content, ttl, auth, disabled)
                    VALUES ($1, $2, $3, $4, $5, true, false)
                    """,
                    domain_id,
                    canonical,
                    r.type,
                    r.value,
                    r.ttl,
                )
            await bump_soa(conn, domain_id)

            await conn.execute(
                """
                INSERT INTO app.audit_log (token_id, action, subdomain, payload)
                VALUES ($1, 'update', $2, $3::jsonb)
                """,
                token_id,
                canonical,
                _records_json(payload.records),
            )

    now = datetime.now(timezone.utc)
    return SubdomainResponse(
        name=canonical,
        records=payload.records,
        descendants=[],
        updated_at=now,
    )
```

Hoist `SubdomainUpdate` import to the top imports block of the file.

- [ ] **Step 4: Rebuild and re-run**

```bash
cd dns-server
docker compose -f compose.yml -f compose.test.yml up -d --build app
python -m pytest tests/integration/test_api.py::TestPutSubdomain -v
cd ..
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add dns-server/api/routers/subdomains.py dns-server/tests/integration/test_api.py
git commit -m "feat(dns-server): PUT /v1/subdomains/{name} idempotent replace"
```

---

## Task 12: DELETE /v1/subdomains/{name} (with descendant info)

**Files:**
- Modify: `dns-server/api/routers/subdomains.py`
- Modify: `dns-server/tests/integration/test_api.py`

- [ ] **Step 1: Add tests**

Append to `dns-server/tests/integration/test_api.py`:

```python
class TestDeleteSubdomain:
    async def test_delete_returns_orphans(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "blog.tkim.users.example.com",
                "records": [{"type": "CNAME", "value": "tkim.users.example.com."}],
            },
        )
        resp = await client.delete(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] == "tkim.users.example.com"
        assert "blog.tkim.users.example.com" in body["orphaned_descendants"]

    async def test_delete_unknown_returns_404(self, client, auth_headers):
        resp = await client.delete(
            "/v1/subdomains/nope.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 404

    async def test_after_delete_get_returns_404(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.delete(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        resp = await client.get(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 404
```

- [ ] **Step 2: Run, expect failures**

```bash
cd dns-server
python -m pytest tests/integration/test_api.py::TestDeleteSubdomain -v
cd ..
```

Expected: 405 / 404 mismatches.

- [ ] **Step 3: Implement DELETE**

Append to `dns-server/api/routers/subdomains.py`:

```python
from api.models import DeleteResponse  # hoist to top import block


@router.delete("/{name}", response_model=DeleteResponse)
async def delete_subdomain(
    name: str,
    token_id: int = Depends(require_token),
) -> DeleteResponse:
    try:
        canonical = validate_name(name, PARENT_ZONE)
    except ValidationError as exc:
        raise _err400(str(exc))

    async with pool().acquire() as conn:
        async with conn.transaction():
            domain_id = await get_parent_domain_id(conn)

            existing = await conn.fetchval(
                "SELECT count(*) FROM records WHERE domain_id = $1 AND name = $2",
                domain_id,
                canonical,
            )
            if not existing:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"subdomain {canonical} not found",
                )

            descendant_rows = await conn.fetch(
                """
                SELECT DISTINCT name FROM records
                WHERE domain_id = $1
                  AND name LIKE '%.' || $2
                  AND type NOT IN ('SOA', 'NS')
                ORDER BY name
                """,
                domain_id,
                canonical,
            )

            await conn.execute(
                "DELETE FROM records WHERE domain_id = $1 AND name = $2",
                domain_id,
                canonical,
            )
            await bump_soa(conn, domain_id)

            await conn.execute(
                """
                INSERT INTO app.audit_log (token_id, action, subdomain, payload)
                VALUES ($1, 'delete', $2, NULL)
                """,
                token_id,
                canonical,
            )

    return DeleteResponse(
        deleted=canonical,
        orphaned_descendants=[r["name"] for r in descendant_rows],
    )
```

- [ ] **Step 4: Rebuild and re-run**

```bash
cd dns-server
docker compose -f compose.yml -f compose.test.yml up -d --build app
python -m pytest tests/integration/test_api.py::TestDeleteSubdomain -v
cd ..
```

Expected: All pass.

- [ ] **Step 5: Run the full integration suite**

```bash
cd dns-server
python -m pytest tests/integration/test_api.py -v
cd ..
```

Expected: All pass (POST + GET + PUT + DELETE).

- [ ] **Step 6: Commit**

```bash
git add dns-server/api/routers/subdomains.py dns-server/tests/integration/test_api.py
git commit -m "feat(dns-server): DELETE /v1/subdomains/{name} with orphan reporting"
```

---

## Task 13: DNS-level integration tests (dnspython)

**Files:**
- Modify: `dns-server/requirements.txt`
- Create: `dns-server/tests/integration/test_dns.py`

- [ ] **Step 1: Add dnspython to requirements**

Append to `dns-server/requirements.txt`:

```
dnspython==2.6.1
```

- [ ] **Step 2: Create `dns-server/tests/integration/test_dns.py`**

PowerDNS gpgsql cache TTL is 10 s by default. Tests sleep 12 s after writes.

```python
"""End-to-end DNS resolution tests.

Uses dnspython to query the PowerDNS instance bound on localhost:53
(host network mode). Allows ~12 s after each API write for the gpgsql
cache to expire.
"""

import asyncio

import dns.resolver
import pytest

DNS_HOST = "127.0.0.1"
DNS_PORT = 53
PROPAGATE = 12  # PowerDNS gpgsql cache default 10s + slack


def _resolver():
    r = dns.resolver.Resolver(configure=False)
    r.nameservers = [DNS_HOST]
    r.port = DNS_PORT
    r.timeout = 3
    r.lifetime = 5
    return r


class TestDnsResolution:
    async def test_a_record_resolves(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await asyncio.sleep(PROPAGATE)
        ans = _resolver().resolve("tkim.users.example.com", "A")
        assert {r.to_text() for r in ans} == {"203.0.113.42"}

    async def test_cname_resolves(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "blog.tkim.users.example.com",
                "records": [{"type": "CNAME", "value": "tkim.users.example.com."}],
            },
        )
        await asyncio.sleep(PROPAGATE)
        ans = _resolver().resolve("blog.tkim.users.example.com", "CNAME")
        assert any("tkim.users.example.com" in r.to_text() for r in ans)

    async def test_delete_yields_nxdomain(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await asyncio.sleep(PROPAGATE)
        await client.delete(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        await asyncio.sleep(PROPAGATE)
        with pytest.raises(dns.resolver.NXDOMAIN):
            _resolver().resolve("tkim.users.example.com", "A")
```

- [ ] **Step 3: Run DNS suite (compose stack already running)**

```bash
cd dns-server
docker compose -f compose.yml -f compose.test.yml up -d --build app
python -m pip install dnspython==2.6.1
python -m pytest tests/integration/test_dns.py -v
cd ..
```

Expected: All pass. Note: this assumes :53 is reachable on the host; the `pdns` container uses `network_mode: host`. If your dev machine already has systemd-resolved on :53, run on a VM/CI box or temporarily disable the stub listener.

- [ ] **Step 4: Run full test suite**

```bash
cd dns-server
python -m pytest tests/ -v
cd ..
```

Expected: Unit (validators, auth) + integration (api + dns) all pass.

- [ ] **Step 5: Tear down test stack**

```bash
cd dns-server
docker compose -f compose.yml -f compose.test.yml down -v
cd ..
```

- [ ] **Step 6: Commit**

```bash
git add dns-server/tests/integration/test_dns.py dns-server/requirements.txt
git commit -m "test(dns-server): add dnspython integration tests for resolution and NXDOMAIN"
```

---

## Task 14: conoha.yml

**Files:**
- Create: `dns-server/conoha.yml`

- [ ] **Step 1: Create the file**

```yaml
name: dns-server
# Replace with your own FQDN before running `conoha app init`.
hosts:
  - api.example.com
web:
  service: app
  port: 8080
# pdns-init seeds the schema and zone, then exits. pdns binds the host's
# :53 directly. db is a single PostgreSQL instance shared by both. None
# of these can be duplicated per blue/green slot — they hold state or
# the only authoritative DNS listener.
health:
  path: /health
  unhealthy_threshold: 24    # 24 × 5s = 120s, covers init + first boot
accessories:
  - pdns
  - db
  - pdns-init
```

- [ ] **Step 2: Commit**

```bash
git add dns-server/conoha.yml
git commit -m "feat(dns-server): add conoha.yml — web only via proxy, DNS via host net"
```

---

## Task 15: examples/curl.sh

**Files:**
- Create: `dns-server/examples/curl.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# End-to-end curl walkthrough for the dns-server admin API.
#
# Usage:
#   export TOKEN="<value printed in pdns-init log>"
#   export API="https://api.example.com"   # or http://127.0.0.1:8080 in dev
#   ./examples/curl.sh
set -euo pipefail

: "${TOKEN:?set TOKEN to the admin token from the pdns-init log}"
API="${API:-https://api.example.com}"

echo "==> Zone meta (no auth required)"
curl -fsS "$API/v1/zone" | tee /dev/stderr; echo

echo "==> Create tkim.users.example.com (A + TXT)"
curl -fsS -X POST "$API/v1/subdomains" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tkim.users.example.com",
    "records": [
      {"type": "A", "value": "203.0.113.42"},
      {"type": "TXT", "value": "v=spf1 -all"}
    ]
  }' | tee /dev/stderr; echo

echo "==> Create blog.tkim.users.example.com (CNAME)"
curl -fsS -X POST "$API/v1/subdomains" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "blog.tkim.users.example.com",
    "records": [{"type": "CNAME", "value": "tkim.users.example.com."}]
  }' | tee /dev/stderr; echo

echo "==> List"
curl -fsS "$API/v1/subdomains" -H "Authorization: Bearer $TOKEN" | tee /dev/stderr; echo

echo "==> Replace tkim with new IP (PUT)"
curl -fsS -X PUT "$API/v1/subdomains/tkim.users.example.com" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"records":[{"type":"A","value":"203.0.113.99"}]}' | tee /dev/stderr; echo

echo "==> Delete tkim (blog. is reported as orphan)"
curl -fsS -X DELETE "$API/v1/subdomains/tkim.users.example.com" \
  -H "Authorization: Bearer $TOKEN" | tee /dev/stderr; echo

echo "==> Done"
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x dns-server/examples/curl.sh
git add dns-server/examples/curl.sh
git commit -m "docs(dns-server): add end-to-end curl walkthrough example"
```

---

## Task 16: README

**Files:**
- Create: `dns-server/README.md`
- Modify: `README.md` (top-level — add row to sample table)

- [ ] **Step 1: Create `dns-server/README.md`**

````markdown
# dns-server — 個人向け DNS ホスティングサンプル

[ndnd.jp](https://ndnd.jp/) のようにサブドメインを払い出せる権威 DNS サーバーを ConoHa VPS3 上にセルフホストするサンプル。`PowerDNS Authoritative` + `PostgreSQL gpgsql` バックエンド + `FastAPI` 製の管理 API という構成で、`curl` から `tkim.users.example.com` のようなサブドメインを CRUD できる。

## 構成

```
                                        Internet
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  │ :53/udp,tcp             │ :443                    │
                  ▼                         ▼                         │
     ┌─────────────────────┐    ┌──────────────────────┐              │
     │ PowerDNS (host net) │    │ conoha-proxy (HTTPS) │              │
     └────────────┬─────────┘    └──────────┬───────────┘              │
                  │                          ▼                          │
                  │              ┌──────────────────────┐               │
                  │              │ FastAPI (:8080)      │               │
                  │              │ Bearer token auth    │               │
                  │              └──────────┬───────────┘               │
                  ▼                         ▼                           │
              ┌────────────────────────────────────┐                    │
              │ PostgreSQL 17 (gpgsql + app schema)│                    │
              └────────────────────────────────────┘                    │
                                  └─────────────────────────────────────┘
```

| サービス | 役割 |
|---------|-----|
| `pdns` | PowerDNS Authoritative 4.9。`network_mode: host` で `:53/udp,tcp` を直接占有。 |
| `app` | FastAPI 管理 API。conoha-proxy 経由で HTTPS 公開。 |
| `db` | PostgreSQL 17。PowerDNS gpgsql スキーマ + 我々の `app` スキーマを保持。 |
| `pdns-init` | 起動時 1 回実行: スキーマ適用 + 親 zone (SOA/NS) 種付け + admin token 生成。 |

## 前提

- `conoha-cli >= 0.3.0`
- 自前ドメイン (例 `example.com`) を保有
- VPS の `:53/udp`, `:53/tcp`, `:443` が開放可能

## デプロイ

### 1. レジストラで NS 委任

レジストラのコントロールパネルで、自分が管理したい親ゾーン (例 `users.example.com`) の NS レコードを VPS の IP に向ける:

```
users.example.com.    NS    ns1.example.com.
ns1.example.com.      A     <VPS IP>
```

`ns1.example.com` の glue を提供できないレジストラの場合は、A レコードと NS の親ドメインで対応する手順を README で各自確認。

### 2. systemd-resolved の `:53` を解放 (Ubuntu 24.04)

```bash
sudo sed -i 's/^#DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo sed -i 's/^DNSStubListener=yes/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
```

### 3. ファイアウォール

```bash
sudo ufw allow 53/udp
sudo ufw allow 53/tcp
```

### 4. ConoHa VPS 起動 + デプロイ

```bash
# サーバー作成
conoha server create --name dns-server --flavor g2l-t-1 --image ubuntu-24.04 --key mykey

# proxy 起動 (1 度のみ)
conoha proxy boot --acme-email you@example.com dns-server

# conoha.yml の hosts: と各環境変数を編集してから:
conoha app init dns-server
conoha app deploy dns-server
```

### 5. 環境変数

`compose.yml` の各 `${VAR:-default}` は以下で上書き可能。本番では最低限 `PARENT_ZONE`, `PRIMARY_NS`, `SOA_EMAIL`, `POSTGRES_PASSWORD` を上書きする:

| 変数 | 既定 | 用途 |
|------|------|------|
| `PARENT_ZONE` | `users.example.com` | 管理する親ゾーン |
| `PRIMARY_NS` | `ns1.example.com.` | SOA / NS の primary nameserver。trailing dot 必須 |
| `SOA_EMAIL` | `admin.example.com.` | SOA RNAME (`@` を `.` に置換した DNS 形式) |
| `POSTGRES_PASSWORD` | `pdns` | DB パスワード |
| `ADMIN_TOKEN` | (空) | 空ならコンテナログに 1 度だけ生成・出力 |
| `ENV` | `prod` | `dev` で `/docs` 露出 |

### 6. 初回起動時のトークン取得

```bash
conoha app logs dns-server pdns-init
# 出力に "ADMIN_TOKEN=..." の行が含まれる (初回のみ)
```

## API 早見表

| Method | Path | 認証 | 用途 |
|--------|------|-----|-----|
| `GET` | `/health` | 不要 | DB 疎通確認 |
| `GET` | `/v1/zone` | 不要 | 親 zone のメタ |
| `GET` | `/v1/subdomains` | 必要 | 一覧 |
| `POST` | `/v1/subdomains` | 必要 | 新規作成 (重複は 409) |
| `GET` | `/v1/subdomains/{name}` | 必要 | 単件 + 子孫情報 |
| `PUT` | `/v1/subdomains/{name}` | 必要 | records 全置換 (idempotent) |
| `DELETE` | `/v1/subdomains/{name}` | 必要 | 削除。子孫がいれば応答に告知 |

エンドツーエンド例は [`examples/curl.sh`](examples/curl.sh) 参照。

### サポートするレコードタイプ

`A`, `AAAA`, `CNAME`, `TXT`。MX/SRV/NS は v1 範囲外。CNAME は同一名の他レコードと共存不可 (RFC 1034)。

### バリデーション

- 名前は親ゾーンで終わる (例: `*.users.example.com`)
- 各ラベルは RFC 1035 (1-63 文字、`[a-z0-9-]`、ハイフン先頭/末尾不可)
- 先頭ラベルが予約語 (`www`, `api`, `admin`, `mail`, `ns`, `ns1`, `ns2`, `mx`, `localhost`, `root`) の場合は拒否
- 1 サブドメインあたりレコード数 ≤ 20
- TTL は 60 ≤ ttl ≤ 86400

## 動作確認

```bash
# 親ゾーンの SOA
dig @<VPS-IP> users.example.com SOA +short

# 作成後の名前解決 (PowerDNS gpgsql キャッシュ満了まで最大 ~10s)
dig @<VPS-IP> tkim.users.example.com A +short
dig @<VPS-IP> blog.tkim.users.example.com CNAME +short

# 削除後
dig @<VPS-IP> tkim.users.example.com A    # → SERVFAIL/NXDOMAIN
```

## テスト

```bash
docker compose -f compose.yml -f compose.test.yml up -d --build
pip install -r requirements.txt
pytest tests/ -v
docker compose -f compose.yml -f compose.test.yml down -v
```

## 既知の制限

- **冗長化**: v1 は単一 VPS、secondary なし。本番は最低 2 台必要
- **DNSSEC**: 未対応。`pdnsutil secure-zone <zone>` を `pdns` コンテナで実行すれば後付け可能
- **abuse 対策**: 認証トークンのみ。レート制限・CAPTCHA は未実装
- **`network_mode: host`**: pdns コンテナは Docker bridge の名前解決ができないため、`db` を `127.0.0.1:5432` に bind-publish して `pdns.conf` から `gpgsql-host=127.0.0.1` で参照している

## 参考

- [PowerDNS Authoritative Server](https://doc.powerdns.com/authoritative/)
- [PowerDNS gpgsql backend schema](https://github.com/PowerDNS/pdns/blob/master/modules/gpgsqlbackend/schema.pgsql.sql)
- [ndnd.jp](https://ndnd.jp/) — 着想元
````

- [ ] **Step 2: Add row to top-level `README.md` sample table**

Find the existing table in the repo root `README.md` (the markdown table listing each sample). Add a new row after the relevant alphabetical position:

```markdown
| [dns-server](dns-server/) | PowerDNS + PostgreSQL + FastAPI | 個人向け DNS ホスティング (サブドメイン CRUD API 付き) | g2l-t-1 (1GB) |
```

(Position depends on the existing ordering — match it.)

- [ ] **Step 3: Commit**

```bash
git add dns-server/README.md README.md
git commit -m "docs(dns-server): add README with deploy / API / DNS verification guide"
```

---

## Final verification

- [ ] **Step 1: Run the full test suite once more**

```bash
cd dns-server
docker compose -f compose.yml -f compose.test.yml up -d --build
python -m pytest tests/ -v
docker compose -f compose.yml -f compose.test.yml down -v
cd ..
```

Expected: all green.

- [ ] **Step 2: Confirm conoha-cli config validates**

```bash
cd dns-server
conoha app validate || true   # if `conoha app validate` is available; else skip
cd ..
```

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/dns-server-sample
gh pr create --title "feat(dns-server): personal DNS hosting sample with FastAPI admin API" \
  --body "$(cat <<'EOF'
## Summary
- New `dns-server/` sample: PowerDNS Authoritative + PostgreSQL + FastAPI admin API
- Single-tenant Bearer-token auth; flat single-zone record management
- A/AAAA/CNAME/TXT supported; CNAME exclusivity and reserved-label policy enforced

## Test plan
- [ ] `docker compose up -d` then `pytest tests/` passes (unit + integration + DNS)
- [ ] `conoha app deploy` succeeds on `g2l-t-1` Ubuntu 24.04
- [ ] `dig` against VPS resolves created subdomains; NXDOMAIN after delete
- [ ] curl walkthrough in `examples/curl.sh` runs clean

Closes #94

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- After each task, the working tree should be clean (no uncommitted changes).
- If a step's "expected" output diverges (different error message, different status code), STOP and investigate before proceeding — the divergence is often the bug, not the test.
- Image tags in the spec/plan (`postgres:17-alpine`, `powerdns/pdns-auth-49:4.9`, `python:3.13-slim`) are starting points; if a tag is missing on Docker Hub at execution time, pin to the closest available patch and note it in the commit.
- If `network_mode: host` for `pdns` conflicts with the executor's local environment (e.g., another :53 listener), do the integration tests on a clean VM or in CI.
