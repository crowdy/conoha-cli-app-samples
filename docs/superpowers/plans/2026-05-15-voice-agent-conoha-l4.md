# voice-agent-conoha-l4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted voice agent sample on ConoHa VPS3 L4 GPU that replaces the OpenAI Realtime API dependency with Pipecat + faster-whisper + vLLM (Qwen2.5-7B-Instruct-AWQ) + Style-BERT-VITS2, while preserving the 3-mode demo, function calling, and Google Sheets fan-out.

**Architecture:** Four containers on a single L4 24GB GPU node — `frontend` (Next.js 16 QR + WebRTC client), `agent` (Pipecat + aiortc), `llm` (vLLM OpenAI-compat), `backend` (FastAPI orders + Sheets + WS). Browser ↔ agent over WebRTC; agent ↔ llm/backend over internal HTTP.

**Tech Stack:** Python 3.12, FastAPI, Pipecat, aiortc, faster-whisper, vLLM, Style-BERT-VITS2, Next.js 16 / React 19, TypeScript, Google Sheets API, docker compose, ConoHa CLI v0.8.

**Spec:** `docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md`

**Branch:** `feat/voice-agent-conoha-l4` (already created from `main`, spec already committed).

---

## Conventions

- All Python: Python 3.12, type hints, pytest, ruff (line length 100).
- All commits: conventional commits (`feat(scope): ...`, `test(scope): ...`).
- Phase boundaries are commit-and-push checkpoints.
- "Backend" = `voice-agent-conoha-l4/backend/`. "Agent" = `voice-agent-conoha-l4/agent/`. Etc.
- When copying from PR #105 (`voice-agent-webrtc-realtime/`), source is the **`feat/voice-agent-webrtc-realtime`** branch. Use `git show feat/voice-agent-webrtc-realtime:<path>` to extract content (we're working on `feat/voice-agent-conoha-l4` which is branched from `main`, so PR #105 files are not on this branch's tree).

---

# Phase A — Project scaffold

## Task 1: Create sample directory and top-level placeholder files

**Files:**
- Create: `voice-agent-conoha-l4/.gitkeep`

- [ ] **Step 1: Create the sample directory**

```bash
mkdir -p voice-agent-conoha-l4
touch voice-agent-conoha-l4/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add voice-agent-conoha-l4/.gitkeep
git commit -m "chore(voice-agent-conoha-l4): create sample directory"
```

---

# Phase B — Backend (HTTP API, Sheets, WS) — no GPU required

## Task 2: Backend Python project scaffold

**Files:**
- Create: `voice-agent-conoha-l4/backend/pyproject.toml`
- Create: `voice-agent-conoha-l4/backend/requirements.txt`
- Create: `voice-agent-conoha-l4/backend/requirements-dev.txt`
- Create: `voice-agent-conoha-l4/backend/app/__init__.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/__init__.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "voice-agent-backend"
version = "0.1.0"
requires-python = ">=3.12"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.pytest.ini_options]
pythonpath = ["."]
markers = ["gpu: requires GPU runtime (skipped in CI)"]
```

- [ ] **Step 2: Write `requirements.txt`**

```
fastapi==0.115.5
uvicorn[standard]==0.32.1
pydantic==2.10.3
google-api-python-client==2.155.0
google-auth==2.36.0
google-auth-httplib2==0.2.0
```

- [ ] **Step 3: Write `requirements-dev.txt`**

```
-r requirements.txt
pytest==8.3.4
pytest-asyncio==0.24.0
pytest-httpx==0.34.0
httpx==0.27.2
ruff==0.8.4
```

- [ ] **Step 4: Create empty `__init__.py` for `app/` and `app/tests/`**

```bash
mkdir -p voice-agent-conoha-l4/backend/app/tests
touch voice-agent-conoha-l4/backend/app/__init__.py
touch voice-agent-conoha-l4/backend/app/tests/__init__.py
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/backend/
git commit -m "feat(backend): scaffold Python project"
```

## Task 3: Backend settings module

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/settings.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_settings.py`

- [ ] **Step 1: Write failing test for default values**

```python
# voice-agent-conoha-l4/backend/app/tests/test_settings.py
import importlib
import os


def reload_settings():
    from app import settings
    return importlib.reload(settings)


def test_defaults(monkeypatch):
    for k in ("ALLOWED_ORIGINS", "ORDERS_RATE_LIMIT_PER_MIN", "SHEET_ID",
             "GOOGLE_APPLICATION_CREDENTIALS_JSON", "RESTAURANT_NAME"):
        monkeypatch.delenv(k, raising=False)
    s = reload_settings()
    assert s.ALLOWED_ORIGINS == []
    assert s.ORDERS_RATE_LIMIT_PER_MIN == 30
    assert s.SHEET_ID == ""
    assert s.RESTAURANT_NAME == "カフェ・コノハ"


def test_allowed_origins_parsed(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example.com, https://b.example.com")
    s = reload_settings()
    assert s.ALLOWED_ORIGINS == ["https://a.example.com", "https://b.example.com"]
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd voice-agent-conoha-l4/backend && pytest app/tests/test_settings.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.settings'`.

- [ ] **Step 3: Write `settings.py`**

```python
# voice-agent-conoha-l4/backend/app/settings.py
import os

GOOGLE_APPLICATION_CREDENTIALS_JSON = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "")
SHEET_ID = os.environ.get("SHEET_ID", "")
RESTAURANT_NAME = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

ORDERS_RATE_LIMIT_PER_MIN = int(os.environ.get("ORDERS_RATE_LIMIT_PER_MIN", "30"))
```

- [ ] **Step 4: Run test — expect pass**

```bash
pytest app/tests/test_settings.py -v
```

Expected: PASS, 2 passed.

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/settings.py voice-agent-conoha-l4/backend/app/tests/test_settings.py
git commit -m "feat(backend): add settings module"
```

## Task 4: Backend security middleware — Origin allowlist + generic IP rate limit

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/security.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_security.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/backend/app/tests/test_security.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security import OriginGuardMiddleware, OrdersRateLimitMiddleware, reset_orders_bucket


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://allowed.example.com")
    monkeypatch.setenv("ORDERS_RATE_LIMIT_PER_MIN", "3")
    import importlib
    from app import settings
    importlib.reload(settings)
    reset_orders_bucket()

    app = FastAPI()
    app.add_middleware(OrdersRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)

    @app.post("/api/orders")
    def fake_orders():
        return {"ok": True}

    @app.get("/")
    def root():
        return {"ok": True}

    return TestClient(app)


def test_origin_allowed(client):
    r = client.post("/api/orders", headers={"origin": "https://allowed.example.com"})
    assert r.status_code == 200


def test_origin_blocked(client):
    r = client.post("/api/orders", headers={"origin": "https://evil.example.com"})
    assert r.status_code == 403


def test_non_api_route_skips_origin_check(client):
    r = client.get("/", headers={"origin": "https://evil.example.com"})
    assert r.status_code == 200


def test_orders_rate_limit(client):
    h = {"origin": "https://allowed.example.com", "x-forwarded-for": "1.2.3.4"}
    assert client.post("/api/orders", headers=h).status_code == 200
    assert client.post("/api/orders", headers=h).status_code == 200
    assert client.post("/api/orders", headers=h).status_code == 200
    assert client.post("/api/orders", headers=h).status_code == 429
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest app/tests/test_security.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write `security.py`**

```python
# voice-agent-conoha-l4/backend/app/security.py
"""Origin allowlist and per-IP rate limit middleware for /api/*.

Both are intentionally small in-process gates. A production deploy should
use a proper WAF / API gateway in front.
"""
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app import settings


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _origin_allowed(request: Request) -> bool:
    if not settings.ALLOWED_ORIGINS:
        return True
    origin = request.headers.get("origin") or request.headers.get("referer", "")
    if not origin:
        return False
    return any(origin.startswith(allowed) for allowed in settings.ALLOWED_ORIGINS)


class OriginGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if not _origin_allowed(request):
                return JSONResponse({"detail": "origin not allowed"}, status_code=403)
        return await call_next(request)


class _IPBucket:
    def __init__(self, max_per_minute: int):
        self._max = max_per_minute
        self._hits: dict[str, deque[float]] = {}

    def check(self, ip: str) -> bool:
        now = time.monotonic()
        cutoff = now - 60.0
        dq = self._hits.setdefault(ip, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= self._max:
            return False
        dq.append(now)
        return True

    def reset(self) -> None:
        self._hits.clear()


_orders_bucket = _IPBucket(settings.ORDERS_RATE_LIMIT_PER_MIN)


def reset_orders_bucket() -> None:
    _orders_bucket._max = settings.ORDERS_RATE_LIMIT_PER_MIN
    _orders_bucket.reset()


class OrdersRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/orders") and request.method != "GET":
            if not _orders_bucket.check(_client_ip(request)):
                return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        return await call_next(request)
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_security.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/security.py voice-agent-conoha-l4/backend/app/tests/test_security.py
git commit -m "feat(backend): add Origin allowlist + IP rate limit middleware"
```

## Task 5: Backend models

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/models.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_models.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/backend/app/tests/test_models.py
import pytest
from pydantic import ValidationError

from app.models import (
    CreateOrderRequest, UpdateOrderRequest, Order, OrderItem,
    Mode, order_to_row,
)


def test_mode_literal_accepts_known():
    req = CreateOrderRequest(mode="emergency", language="ja",
                             items=[OrderItem(name="x", qty=1)])
    assert req.mode == "emergency"


def test_mode_literal_rejects_unknown():
    with pytest.raises(ValidationError):
        CreateOrderRequest(mode="unknown", language="ja",
                           items=[OrderItem(name="x", qty=1)])


def test_order_to_row_format():
    order = Order(
        order_id="ord_abc",
        mode="callcenter",
        language="ja",
        customer_label=None,
        items=[OrderItem(name="親子丼", qty=2)],
        notes=None,
        status="pending",
        created_at="2026-05-15T10:00:00Z",
        updated_at="2026-05-15T10:00:00Z",
    )
    row = order_to_row(order)
    assert row[0] == "ord_abc"
    assert "親子丼" in row[5]  # items column
    assert "2" in row[5]
    assert row[3] == "callcenter"
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest app/tests/test_models.py -v
```

- [ ] **Step 3: Write `models.py`**

```python
# voice-agent-conoha-l4/backend/app/models.py
import json
from typing import Literal

from pydantic import BaseModel, Field

Mode = Literal["emergency", "military", "callcenter"]
Language = Literal["ja", "en", "ko"]
OrderStatus = Literal["pending", "persisted", "closed", "error"]


class OrderItem(BaseModel):
    name: str
    qty: int = Field(ge=1)
    note: str | None = None


class CreateOrderRequest(BaseModel):
    mode: Mode
    language: Language
    customer_label: str | None = None
    items: list[OrderItem]


class UpdateOrderRequest(BaseModel):
    items: list[OrderItem]
    notes: str | None = None


class Order(BaseModel):
    order_id: str
    mode: Mode
    language: Language
    customer_label: str | None
    items: list[OrderItem]
    notes: str | None
    status: OrderStatus
    created_at: str
    updated_at: str


class RecentOrdersResponse(BaseModel):
    orders: list[Order]


def order_to_row(order: Order) -> list[str]:
    items_str = ", ".join(f"{i.name} x{i.qty}" for i in order.items)
    return [
        order.order_id,
        order.created_at,
        order.updated_at,
        order.mode,
        order.language,
        items_str,
        order.customer_label or "",
        order.notes or "",
        order.status,
    ]
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_models.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/models.py voice-agent-conoha-l4/backend/app/tests/test_models.py
git commit -m "feat(backend): add Pydantic models for orders"
```

## Task 6: Backend in-memory order store

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/store.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_store.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/backend/app/tests/test_store.py
from app.models import Order, OrderItem
from app.store import OrderStore


def _make(oid: str = "ord_1") -> Order:
    return Order(
        order_id=oid, mode="callcenter", language="ja", customer_label=None,
        items=[OrderItem(name="x", qty=1)], notes=None,
        status="pending", created_at="t", updated_at="t",
    )


def test_create_and_get():
    s = OrderStore()
    order = s.create(_make("ord_a"))
    assert s.get("ord_a") == order


def test_update_replaces_items():
    s = OrderStore()
    s.create(_make("ord_b"))
    updated = s.update("ord_b", items=[OrderItem(name="y", qty=3)], notes="n")
    assert updated.items[0].name == "y"
    assert updated.notes == "n"


def test_close_sets_status():
    s = OrderStore()
    s.create(_make("ord_c"))
    closed = s.close("ord_c")
    assert closed.status == "closed"


def test_recent_returns_in_reverse_order():
    s = OrderStore()
    s.create(_make("ord_1"))
    s.create(_make("ord_2"))
    recent = s.recent(limit=10)
    assert [o.order_id for o in recent] == ["ord_2", "ord_1"]


def test_delete_removes():
    s = OrderStore()
    s.create(_make("ord_x"))
    s.delete("ord_x")
    assert s.get("ord_x") is None
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest app/tests/test_store.py -v
```

- [ ] **Step 3: Write `store.py`**

```python
# voice-agent-conoha-l4/backend/app/store.py
import threading
from datetime import datetime, timezone

from app.models import Order, OrderItem


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class OrderStore:
    """In-memory ordered dict of orders. Thread-safe for the FastAPI
    single-process deployment used by this sample."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._orders: dict[str, Order] = {}

    def create(self, order: Order) -> Order:
        with self._lock:
            self._orders[order.order_id] = order
        return order

    def get(self, order_id: str) -> Order | None:
        return self._orders.get(order_id)

    def update(self, order_id: str, items: list[OrderItem], notes: str | None) -> Order:
        with self._lock:
            cur = self._orders[order_id]
            new = cur.model_copy(update={
                "items": items,
                "notes": notes,
                "status": "persisted",
                "updated_at": _now(),
            })
            self._orders[order_id] = new
            return new

    def close(self, order_id: str) -> Order:
        with self._lock:
            cur = self._orders[order_id]
            new = cur.model_copy(update={"status": "closed", "updated_at": _now()})
            self._orders[order_id] = new
            return new

    def restore(self, order: Order) -> None:
        with self._lock:
            self._orders[order.order_id] = order

    def delete(self, order_id: str) -> None:
        with self._lock:
            self._orders.pop(order_id, None)

    def recent(self, limit: int = 10) -> list[Order]:
        return list(reversed(list(self._orders.values())))[:limit]
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_store.py -v
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/store.py voice-agent-conoha-l4/backend/app/tests/test_store.py
git commit -m "feat(backend): add in-memory OrderStore"
```

## Task 7: Backend SheetsClient with credential sanitization

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/sheets.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_sheets.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/backend/app/tests/test_sheets.py
import pytest

from app.sheets import SheetsClient, SheetsConfigError


def test_invalid_json_raises_without_leaking_key():
    with pytest.raises(SheetsConfigError) as ei:
        SheetsClient(credentials_json="not-a-json", sheet_id="x")
    assert "private_key" not in str(ei.value)
    assert "invalid GOOGLE_APPLICATION_CREDENTIALS_JSON" in str(ei.value)


def test_missing_field_raises_without_leaking_key():
    payload = '{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----LEAK"}'
    with pytest.raises(SheetsConfigError) as ei:
        SheetsClient(credentials_json=payload, sheet_id="x")
    assert "LEAK" not in str(ei.value)
    assert "private_key" not in str(ei.value)
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest app/tests/test_sheets.py -v
```

- [ ] **Step 3: Write `sheets.py`**

```python
# voice-agent-conoha-l4/backend/app/sheets.py
"""Google Sheets append/update wrapper.

Errors are sanitized so service account credentials (private_key, etc.) are
never echoed back in exception messages or logs.
"""
import json
import logging

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
_SHEET_TAB = "orders"


class SheetsConfigError(Exception):
    pass


class SheetsClient:
    def __init__(self, credentials_json: str, sheet_id: str) -> None:
        try:
            info = json.loads(credentials_json)
        except json.JSONDecodeError as exc:
            raise SheetsConfigError(
                f"invalid GOOGLE_APPLICATION_CREDENTIALS_JSON (parse error at pos {exc.pos})"
            ) from None

        try:
            creds = Credentials.from_service_account_info(info, scopes=_SCOPES)
        except Exception as exc:
            # exc may include parts of the private_key — never re-raise verbatim
            logger.error("service_account credentials rejected: %s", type(exc).__name__)
            raise SheetsConfigError(
                "invalid GOOGLE_APPLICATION_CREDENTIALS_JSON (missing or malformed fields)"
            ) from None

        self._svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
        self._sheet_id = sheet_id

    def append_order(self, row: list[str]) -> None:
        self._svc.spreadsheets().values().append(
            spreadsheetId=self._sheet_id,
            range=f"{_SHEET_TAB}!A1",
            valueInputOption="RAW",
            body={"values": [row]},
        ).execute()

    def find_row(self, order_id: str) -> int | None:
        result = self._svc.spreadsheets().values().get(
            spreadsheetId=self._sheet_id,
            range=f"{_SHEET_TAB}!A:A",
        ).execute()
        values = result.get("values", [])
        for idx, vals in enumerate(values, start=1):
            if vals and vals[0] == order_id:
                return idx
        return None

    def update_row(self, row_number: int, row: list[str]) -> None:
        self._svc.spreadsheets().values().update(
            spreadsheetId=self._sheet_id,
            range=f"{_SHEET_TAB}!A{row_number}",
            valueInputOption="RAW",
            body={"values": [row]},
        ).execute()
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_sheets.py -v
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/sheets.py voice-agent-conoha-l4/backend/app/tests/test_sheets.py
git commit -m "feat(backend): add SheetsClient with credential-safe errors"
```

## Task 8: Backend events router (WS fan-out)

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/routers/__init__.py`
- Create: `voice-agent-conoha-l4/backend/app/routers/events.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_events.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/backend/app/tests/test_events.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.events import EventBroker, router


@pytest.fixture
def app():
    a = FastAPI()
    a.state.broker = EventBroker()
    a.include_router(router)
    return a


def test_ws_receives_broadcast(app):
    with TestClient(app) as client:
        with client.websocket_connect("/api/events") as ws:
            # Give the server a tick to register
            import asyncio
            asyncio.get_event_loop().run_until_complete(
                app.state.broker.broadcast({"type": "order_added", "order_id": "x"})
            )
            msg = ws.receive_json()
            assert msg == {"type": "order_added", "order_id": "x"}
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest app/tests/test_events.py -v
```

- [ ] **Step 3: Write `routers/__init__.py` (empty)**

```bash
echo "" > voice-agent-conoha-l4/backend/app/routers/__init__.py
```

- [ ] **Step 4: Write `events.py`**

```python
# voice-agent-conoha-l4/backend/app/routers/events.py
"""WebSocket fan-out for order events.

Each connection joins an async queue. `broadcast()` enqueues to every
queue; per-connection sender drains its queue. Slow consumers do not
block fast ones because each has its own queue (bounded at 64).
"""
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["events"])


class EventBroker:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()

    def add(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._queues.add(q)
        return q

    def remove(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    async def broadcast(self, event: dict) -> None:
        for q in list(self._queues):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("event queue full, dropping for one client")


@router.websocket("/events")
async def events_ws(ws: WebSocket) -> None:
    await ws.accept()
    broker: EventBroker = ws.app.state.broker
    q = broker.add()
    try:
        while True:
            event = await q.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        broker.remove(q)
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pytest app/tests/test_events.py -v
```

- [ ] **Step 6: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/routers/__init__.py voice-agent-conoha-l4/backend/app/routers/events.py voice-agent-conoha-l4/backend/app/tests/test_events.py
git commit -m "feat(backend): add WS event broker"
```

## Task 9: Backend orders router

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/routers/orders.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_orders.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/backend/app/tests/test_orders.py
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.events import EventBroker
from app.routers.orders import router
from app.store import OrderStore


@pytest.fixture
def app():
    a = FastAPI()
    a.state.store = OrderStore()
    a.state.broker = EventBroker()
    a.state.sheets = MagicMock()
    a.state.sheets.find_row.return_value = 2
    a.include_router(router)
    return TestClient(a)


def _payload():
    return {
        "mode": "callcenter", "language": "ja", "customer_label": None,
        "items": [{"name": "親子丼", "qty": 1}],
    }


def test_create_order_appends_to_sheets(app):
    r = app.post("/api/orders", json=_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["order_id"].startswith("ord_")
    assert body["items"][0]["name"] == "親子丼"
    app.app.state.sheets.append_order.assert_called_once()


def test_create_order_rolls_back_on_sheets_failure(app):
    app.app.state.sheets.append_order.side_effect = RuntimeError("network")
    r = app.post("/api/orders", json=_payload())
    assert r.status_code == 502
    assert len(app.app.state.store.recent()) == 0


def test_update_order_modifies_items(app):
    created = app.post("/api/orders", json=_payload()).json()
    r = app.patch(f"/api/orders/{created['order_id']}",
                  json={"items": [{"name": "親子丼", "qty": 2}], "notes": "x"})
    assert r.status_code == 200
    assert r.json()["items"][0]["qty"] == 2


def test_close_order_sets_status(app):
    created = app.post("/api/orders", json=_payload()).json()
    r = app.post(f"/api/orders/{created['order_id']}/close")
    assert r.status_code == 200
    assert r.json()["status"] == "closed"


def test_recent_orders(app):
    app.post("/api/orders", json=_payload())
    app.post("/api/orders", json=_payload())
    r = app.get("/api/orders/recent?limit=5")
    assert len(r.json()["orders"]) == 2


def test_invalid_mode_rejected(app):
    bad = _payload() | {"mode": "intergalactic"}
    assert app.post("/api/orders", json=bad).status_code == 422
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest app/tests/test_orders.py -v
```

- [ ] **Step 3: Write `orders.py`**

```python
# voice-agent-conoha-l4/backend/app/routers/orders.py
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.models import (
    CreateOrderRequest, Order, RecentOrdersResponse, UpdateOrderRequest,
    order_to_row,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_order_id() -> str:
    return "ord_" + uuid.uuid4().hex[:10]


def _broadcast(request: Request, event: dict) -> None:
    asyncio.create_task(request.app.state.broker.broadcast(event))


@router.post("", response_model=Order)
async def create_order(req: CreateOrderRequest, request: Request) -> Order:
    order = Order(
        order_id=_new_order_id(),
        mode=req.mode,
        language=req.language,
        customer_label=req.customer_label,
        items=req.items,
        notes=None,
        status="persisted",
        created_at=_now(),
        updated_at=_now(),
    )
    request.app.state.store.create(order)
    try:
        request.app.state.sheets.append_order(order_to_row(order))
    except Exception:
        request.app.state.store.delete(order.order_id)
        raise HTTPException(status_code=502, detail="sheets append failed")
    _broadcast(request, {"type": "order_added", "order": order.model_dump()})
    return order


@router.patch("/{order_id}", response_model=Order)
async def update_order(order_id: str, req: UpdateOrderRequest, request: Request) -> Order:
    before = request.app.state.store.get(order_id)
    if before is None:
        raise HTTPException(status_code=404, detail="not found")
    after = request.app.state.store.update(order_id, req.items, req.notes)
    try:
        row = request.app.state.sheets.find_row(order_id)
        if row is None:
            raise RuntimeError("sheets row missing")
        request.app.state.sheets.update_row(row, order_to_row(after))
    except Exception:
        request.app.state.store.restore(before)
        raise HTTPException(status_code=502, detail="sheets update failed")
    _broadcast(request, {"type": "order_updated", "order": after.model_dump()})
    return after


@router.post("/{order_id}/close", response_model=Order)
async def close_order(order_id: str, request: Request) -> Order:
    if request.app.state.store.get(order_id) is None:
        raise HTTPException(status_code=404, detail="not found")
    closed = request.app.state.store.close(order_id)
    try:
        row = request.app.state.sheets.find_row(order_id)
        if row is not None:
            request.app.state.sheets.update_row(row, order_to_row(closed))
    except Exception:
        # Sheets sync failure on close is non-fatal — order is already closed in store.
        pass
    _broadcast(request, {"type": "order_closed", "order_id": order_id})
    return closed


@router.get("/recent", response_model=RecentOrdersResponse)
async def recent_orders(request: Request, limit: int = 10) -> RecentOrdersResponse:
    return RecentOrdersResponse(orders=request.app.state.store.recent(limit=limit))
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_orders.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/routers/orders.py voice-agent-conoha-l4/backend/app/tests/test_orders.py
git commit -m "feat(backend): add orders router (create/update/close/recent)"
```

## Task 10: Backend main.py + healthz

**Files:**
- Create: `voice-agent-conoha-l4/backend/app/main.py`
- Create: `voice-agent-conoha-l4/backend/app/tests/test_main.py`

- [ ] **Step 1: Write failing test**

```python
# voice-agent-conoha-l4/backend/app/tests/test_main.py
from unittest.mock import patch

from fastapi.testclient import TestClient


def test_healthz(monkeypatch):
    monkeypatch.setenv("SHEET_ID", "x")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", '{"type":"service_account"}')
    with patch("app.main.SheetsClient") as _:
        from app.main import create_app
        app = create_app()
        with TestClient(app) as client:
            assert client.get("/healthz").status_code == 200
            assert client.get("/healthz").json() == {"ok": True}
```

- [ ] **Step 2: Run — expect failure**

```bash
pytest app/tests/test_main.py -v
```

- [ ] **Step 3: Write `main.py`**

```python
# voice-agent-conoha-l4/backend/app/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import settings
from app.routers.events import EventBroker
from app.routers.events import router as events_router
from app.routers.orders import router as orders_router
from app.security import OrdersRateLimitMiddleware, OriginGuardMiddleware
from app.sheets import SheetsClient
from app.store import OrderStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.store = OrderStore()
    app.state.broker = EventBroker()
    app.state.sheets = SheetsClient(
        credentials_json=settings.GOOGLE_APPLICATION_CREDENTIALS_JSON,
        sheet_id=settings.SHEET_ID,
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="voice-agent-conoha-l4-backend", lifespan=lifespan)
    app.add_middleware(OrdersRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)
    app.include_router(orders_router)
    app.include_router(events_router)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    return app


app = create_app()
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_main.py -v
```

- [ ] **Step 5: Run full backend suite**

```bash
pytest app/ -v
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add voice-agent-conoha-l4/backend/app/main.py voice-agent-conoha-l4/backend/app/tests/test_main.py
git commit -m "feat(backend): wire FastAPI app with healthz + lifespan"
```

## Task 11: Backend Dockerfile

**Files:**
- Create: `voice-agent-conoha-l4/backend/Dockerfile`
- Create: `voice-agent-conoha-l4/backend/.dockerignore`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# voice-agent-conoha-l4/backend/Dockerfile
FROM python:3.12-slim AS deps
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY app/ ./app/
USER nobody
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
__pycache__/
*.pyc
.venv/
.pytest_cache/
.ruff_cache/
*.egg-info/
tests/
```

- [ ] **Step 3: Build image**

```bash
cd voice-agent-conoha-l4/backend && docker build -t voice-agent-backend:dev .
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add voice-agent-conoha-l4/backend/Dockerfile voice-agent-conoha-l4/backend/.dockerignore
git commit -m "feat(backend): add Dockerfile"
```

---

# Phase C — Agent skeleton with mocks (no GPU required)

## Task 12: Agent project scaffold

**Files:**
- Create: `voice-agent-conoha-l4/agent/pyproject.toml`
- Create: `voice-agent-conoha-l4/agent/requirements.txt`
- Create: `voice-agent-conoha-l4/agent/requirements-dev.txt`
- Create: `voice-agent-conoha-l4/agent/app/__init__.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/__init__.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "voice-agent-agent"
version = "0.1.0"
requires-python = ">=3.12"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.pytest.ini_options]
pythonpath = ["."]
asyncio_mode = "auto"
markers = ["gpu: requires GPU runtime (skipped in CI)"]
```

- [ ] **Step 2: Write `requirements.txt`**

```
fastapi==0.115.5
uvicorn[standard]==0.32.1
pydantic==2.10.3
httpx==0.27.2
aiortc==1.9.0
pipecat-ai[silero,whisper]==0.0.50
faster-whisper==1.0.3
openai==1.57.0
numpy==1.26.4
soundfile==0.12.1
style-bert-vits2==2.6.1
```

- [ ] **Step 3: Write `requirements-dev.txt`**

```
-r requirements.txt
pytest==8.3.4
pytest-asyncio==0.24.0
pytest-httpx==0.34.0
ruff==0.8.4
```

- [ ] **Step 4: Create package dirs**

```bash
mkdir -p voice-agent-conoha-l4/agent/app/tests
touch voice-agent-conoha-l4/agent/app/__init__.py voice-agent-conoha-l4/agent/app/tests/__init__.py
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/agent/
git commit -m "feat(agent): scaffold Python project"
```

## Task 13: Agent settings

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/settings.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_settings.py`

- [ ] **Step 1: Write failing test**

```python
# voice-agent-conoha-l4/agent/app/tests/test_settings.py
import importlib


def _reload(monkeypatch):
    from app import settings
    return importlib.reload(settings)


def test_defaults(monkeypatch):
    for k in ("BACKEND_URL", "LLM_URL", "LLM_MODEL", "WHISPER_MODEL_SIZE",
              "ALLOWED_ORIGINS", "OFFER_RATE_LIMIT_PER_MIN",
              "MAX_CONCURRENT_SESSIONS", "SESSION_MAX_DURATION_SEC",
              "SBV2_MODEL_DIR", "RESTAURANT_NAME"):
        monkeypatch.delenv(k, raising=False)
    s = _reload(monkeypatch)
    assert s.BACKEND_URL == "http://backend:8000"
    assert s.LLM_URL == "http://llm:8000/v1"
    assert s.LLM_MODEL == "Qwen/Qwen2.5-7B-Instruct-AWQ"
    assert s.WHISPER_MODEL_SIZE == "medium"
    assert s.OFFER_RATE_LIMIT_PER_MIN == 3
    assert s.MAX_CONCURRENT_SESSIONS == 5
    assert s.SESSION_MAX_DURATION_SEC == 600
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `settings.py`**

```python
# voice-agent-conoha-l4/agent/app/settings.py
import os

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8000")
LLM_URL = os.environ.get("LLM_URL", "http://llm:8000/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct-AWQ")
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "medium")
SBV2_MODEL_DIR = os.environ.get("SBV2_MODEL_DIR", "/models/sbv2")
RESTAURANT_NAME = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

OFFER_RATE_LIMIT_PER_MIN = int(os.environ.get("OFFER_RATE_LIMIT_PER_MIN", "3"))
MAX_CONCURRENT_SESSIONS = int(os.environ.get("MAX_CONCURRENT_SESSIONS", "5"))
SESSION_MAX_DURATION_SEC = int(os.environ.get("SESSION_MAX_DURATION_SEC", "600"))
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd voice-agent-conoha-l4/agent && pytest app/tests/test_settings.py -v
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/settings.py voice-agent-conoha-l4/agent/app/tests/test_settings.py
git commit -m "feat(agent): add settings module"
```

## Task 14: Agent personas (3 modes)

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/personas.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_personas.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/agent/app/tests/test_personas.py
import pytest

from app.personas import PERSONAS, resolve


@pytest.mark.parametrize("mode,marker", [
    ("emergency", "救急"),
    ("military", "作戦"),
    ("callcenter", "ご注文"),
])
def test_each_mode_has_distinct_instructions(mode, marker):
    resolved_mode, instructions = resolve(mode)
    assert resolved_mode == mode
    assert marker in instructions


def test_resolve_rejects_unknown_mode():
    with pytest.raises(ValueError):
        resolve("intergalactic")


def test_all_three_modes_present():
    assert set(PERSONAS) == {"emergency", "military", "callcenter"}
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `personas.py`**

```python
# voice-agent-conoha-l4/agent/app/personas.py
"""System prompts for the three communication-protocol personas.

The same restaurant-order use case is reskinned as emergency dispatch,
military command, and a regular callcenter. Differences live solely in
the system prompt — the tools and downstream Sheets schema are identical.
"""
import os

_RESTAURANT = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")

PERSONAS: dict[str, str] = {
    "emergency": (
        "これは救急通信センターです。要請内容を簡潔に確認します。"
        "聞き取った内容を即座に add_order ツールで登録してください。"
        "口調は冷静で短く、医療従事者の指示に従うトーンを保ってください。"
        f"店舗名: {_RESTAURANT}"
    ),
    "military": (
        "作戦司令部です。報告を受領します。コールサインを発信してください。"
        "受領した品目は add_order ツールで記録します。"
        "口調は無線連絡風、復唱を含めて簡潔に。"
        f"作戦コードネーム: {_RESTAURANT}"
    ),
    "callcenter": (
        f"{_RESTAURANT}、ご注文承ります。"
        "丁寧で温かい接客口調を保ち、聞き漏らしがないよう数量と品名を確認します。"
        "確認できたら add_order ツールで登録し、最後に close_order で締めます。"
    ),
}


def resolve(mode: str) -> tuple[str, str]:
    """Return (mode, instructions) for a valid mode, or raise ValueError."""
    if mode not in PERSONAS:
        raise ValueError(f"unknown mode: {mode}")
    return mode, PERSONAS[mode]
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/personas.py voice-agent-conoha-l4/agent/app/tests/test_personas.py
git commit -m "feat(agent): add 3-mode personas"
```

## Task 15: Agent tools.py — HTTP calls to backend

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/tools.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_tools.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/agent/app/tests/test_tools.py
import pytest

from app.tools import OPENAI_TOOLS, ToolExecutor


pytestmark = pytest.mark.asyncio


async def test_add_order(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders",
        method="POST",
        json={"order_id": "ord_abc", "items": [{"name": "x", "qty": 1}],
              "mode": "callcenter", "language": "ja", "customer_label": None,
              "notes": None, "status": "persisted",
              "created_at": "t", "updated_at": "t"},
    )
    ex = ToolExecutor(mode="callcenter")
    out = await ex.dispatch("add_order", {
        "items": [{"name": "x", "qty": 1}],
        "language": "ja",
    })
    assert out["ok"] is True
    assert out["order_id"] == "ord_abc"


async def test_update_order_passes_id(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders/ord_abc",
        method="PATCH",
        json={"order_id": "ord_abc", "items": [{"name": "y", "qty": 2}],
              "mode": "callcenter", "language": "ja", "customer_label": None,
              "notes": "n", "status": "persisted",
              "created_at": "t", "updated_at": "t"},
    )
    ex = ToolExecutor(mode="callcenter")
    out = await ex.dispatch("update_order", {
        "order_id": "ord_abc",
        "items": [{"name": "y", "qty": 2}], "notes": "n",
    })
    assert out["ok"] is True


async def test_close_order(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders/ord_abc/close",
        method="POST",
        json={"order_id": "ord_abc", "items": [], "mode": "callcenter",
              "language": "ja", "customer_label": None, "notes": None,
              "status": "closed", "created_at": "t", "updated_at": "t"},
    )
    ex = ToolExecutor(mode="callcenter")
    out = await ex.dispatch("close_order", {"order_id": "ord_abc"})
    assert out["status"] == "closed"


async def test_unknown_tool_raises():
    ex = ToolExecutor(mode="callcenter")
    with pytest.raises(ValueError):
        await ex.dispatch("hack", {})


def test_openai_tools_shape():
    names = {t["function"]["name"] for t in OPENAI_TOOLS}
    assert names == {"add_order", "update_order", "close_order", "list_orders"}
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `tools.py`**

```python
# voice-agent-conoha-l4/agent/app/tools.py
"""Tool definitions and dispatcher for the agent.

Tools are described in OpenAI-compatible JSON schema (the format vLLM
accepts via `--enable-auto-tool-choice`). Dispatch translates the LLM's
tool_call into an HTTP call against the backend.
"""
from typing import Any

import httpx

from app import settings

_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "qty": {"type": "integer", "minimum": 1},
        "note": {"type": ["string", "null"]},
    },
    "required": ["name", "qty"],
}

OPENAI_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "add_order",
            "description": "新しい注文を業務システムに追加する。",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {"type": "array", "items": _ITEM_SCHEMA},
                    "customer_label": {"type": "string"},
                    "language": {"type": "string", "enum": ["ja", "en", "ko"]},
                },
                "required": ["items", "language"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_order",
            "description": "直前の注文の数量や品目を変更する。items は変更後の全品目。",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                    "items": {"type": "array", "items": _ITEM_SCHEMA},
                    "notes": {"type": ["string", "null"]},
                },
                "required": ["order_id", "items"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "close_order",
            "description": "注文を確定する。",
            "parameters": {
                "type": "object",
                "properties": {"order_id": {"type": "string"}},
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_orders",
            "description": "当日の最近の注文を確認する。",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 10}},
                "required": [],
            },
        },
    },
]


class ToolExecutor:
    def __init__(self, mode: str, http_client: httpx.AsyncClient | None = None) -> None:
        self._mode = mode
        self._http = http_client or httpx.AsyncClient(timeout=8.0)

    async def dispatch(self, name: str, args: dict) -> dict:
        if name == "add_order":
            body = {
                "mode": self._mode,
                "language": args.get("language", "ja"),
                "customer_label": args.get("customer_label"),
                "items": args["items"],
            }
            r = await self._http.post(f"{settings.BACKEND_URL}/api/orders", json=body)
            r.raise_for_status()
            order = r.json()
            return {"ok": True, "order_id": order["order_id"]}

        if name == "update_order":
            order_id = args["order_id"]
            body = {"items": args["items"], "notes": args.get("notes")}
            r = await self._http.patch(
                f"{settings.BACKEND_URL}/api/orders/{order_id}", json=body
            )
            r.raise_for_status()
            return {"ok": True, "order_id": r.json()["order_id"]}

        if name == "close_order":
            order_id = args["order_id"]
            r = await self._http.post(
                f"{settings.BACKEND_URL}/api/orders/{order_id}/close"
            )
            r.raise_for_status()
            return {"ok": True, "order_id": order_id, "status": "closed"}

        if name == "list_orders":
            limit = args.get("limit", 10)
            r = await self._http.get(
                f"{settings.BACKEND_URL}/api/orders/recent", params={"limit": limit}
            )
            r.raise_for_status()
            return r.json()

        raise ValueError(f"unknown tool: {name}")

    async def aclose(self) -> None:
        await self._http.aclose()
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_tools.py -v
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/tools.py voice-agent-conoha-l4/agent/app/tests/test_tools.py
git commit -m "feat(agent): add tool definitions + HTTP dispatcher"
```

## Task 16: Agent session manager + security (Origin allowlist, /offer rate limit, concurrent cap)

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/sessions.py`
- Create: `voice-agent-conoha-l4/agent/app/security.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_security.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_sessions.py`

- [ ] **Step 1: Write failing tests for sessions**

```python
# voice-agent-conoha-l4/agent/app/tests/test_sessions.py
import pytest

from app.sessions import SessionRegistry


def test_acquire_releases_under_cap():
    reg = SessionRegistry(max_sessions=2)
    assert reg.acquire("s1") is True
    assert reg.acquire("s2") is True
    assert reg.acquire("s3") is False
    reg.release("s1")
    assert reg.acquire("s3") is True


def test_acquire_same_id_idempotent():
    reg = SessionRegistry(max_sessions=2)
    assert reg.acquire("s1") is True
    assert reg.acquire("s1") is True  # same id, no new slot consumed
    assert reg.count() == 1
```

- [ ] **Step 2: Write failing tests for security**

```python
# voice-agent-conoha-l4/agent/app/tests/test_security.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security import OfferRateLimitMiddleware, OriginGuardMiddleware, reset_offer_bucket


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://allowed.example.com")
    monkeypatch.setenv("OFFER_RATE_LIMIT_PER_MIN", "2")
    import importlib
    from app import settings
    importlib.reload(settings)
    reset_offer_bucket()

    app = FastAPI()
    app.add_middleware(OfferRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)

    @app.post("/offer")
    def offer():
        return {"ok": True}

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return TestClient(app)


def test_offer_origin_blocked(client):
    assert client.post("/offer", headers={"origin": "https://evil"}).status_code == 403


def test_offer_rate_limit(client):
    h = {"origin": "https://allowed.example.com", "x-forwarded-for": "9.9.9.9"}
    assert client.post("/offer", headers=h).status_code == 200
    assert client.post("/offer", headers=h).status_code == 200
    assert client.post("/offer", headers=h).status_code == 429


def test_healthz_skips_origin_check(client):
    assert client.get("/healthz", headers={"origin": "https://evil"}).status_code == 200
```

- [ ] **Step 3: Run — expect failure**

- [ ] **Step 4: Write `sessions.py`**

```python
# voice-agent-conoha-l4/agent/app/sessions.py
import threading


class SessionRegistry:
    """Tracks active WebRTC sessions and enforces a global concurrency cap."""

    def __init__(self, max_sessions: int) -> None:
        self._max = max_sessions
        self._lock = threading.Lock()
        self._ids: set[str] = set()

    def acquire(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._ids:
                return True
            if len(self._ids) >= self._max:
                return False
            self._ids.add(session_id)
            return True

    def release(self, session_id: str) -> None:
        with self._lock:
            self._ids.discard(session_id)

    def count(self) -> int:
        return len(self._ids)
```

- [ ] **Step 5: Write `security.py`**

```python
# voice-agent-conoha-l4/agent/app/security.py
"""Origin allowlist and per-IP rate limit on /offer."""
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app import settings


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _origin_allowed(request: Request) -> bool:
    if not settings.ALLOWED_ORIGINS:
        return True
    origin = request.headers.get("origin") or request.headers.get("referer", "")
    if not origin:
        return False
    return any(origin.startswith(allowed) for allowed in settings.ALLOWED_ORIGINS)


class OriginGuardMiddleware(BaseHTTPMiddleware):
    """Apply only to /offer (the only endpoint that consumes GPU)."""

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/offer":
            if not _origin_allowed(request):
                return JSONResponse({"detail": "origin not allowed"}, status_code=403)
        return await call_next(request)


class _IPBucket:
    def __init__(self, max_per_minute: int):
        self._max = max_per_minute
        self._hits: dict[str, deque[float]] = {}

    def check(self, ip: str) -> bool:
        now = time.monotonic()
        cutoff = now - 60.0
        dq = self._hits.setdefault(ip, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= self._max:
            return False
        dq.append(now)
        return True

    def reset(self) -> None:
        self._hits.clear()


_offer_bucket = _IPBucket(settings.OFFER_RATE_LIMIT_PER_MIN)


def reset_offer_bucket() -> None:
    _offer_bucket._max = settings.OFFER_RATE_LIMIT_PER_MIN
    _offer_bucket.reset()


class OfferRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/offer" and request.method == "POST":
            if not _offer_bucket.check(_client_ip(request)):
                return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        return await call_next(request)
```

- [ ] **Step 6: Run tests — expect pass**

```bash
pytest app/tests/test_sessions.py app/tests/test_security.py -v
```

- [ ] **Step 7: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/sessions.py voice-agent-conoha-l4/agent/app/security.py voice-agent-conoha-l4/agent/app/tests/test_sessions.py voice-agent-conoha-l4/agent/app/tests/test_security.py
git commit -m "feat(agent): add SessionRegistry + Origin/rate-limit middleware"
```

## Task 17: Agent service interfaces (Protocol classes for STT/LLM/TTS) and mock implementations

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/services/__init__.py`
- Create: `voice-agent-conoha-l4/agent/app/services/interfaces.py`
- Create: `voice-agent-conoha-l4/agent/app/services/mocks.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_mock_services.py`

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/agent/app/tests/test_mock_services.py
import pytest

from app.services.mocks import MockLLM, MockSTT, MockTTS

pytestmark = pytest.mark.asyncio


async def test_mock_stt_returns_canned_text():
    stt = MockSTT(transcript="親子丼を1つ")
    assert await stt.transcribe(b"\x00\x00") == ("親子丼を1つ", "ja")


async def test_mock_llm_emits_add_order_tool_call():
    llm = MockLLM()
    msgs = [{"role": "user", "content": "親子丼を1つ"}]
    out = await llm.chat(messages=msgs, tools=[], tool_choice="auto")
    assert out["tool_calls"][0]["function"]["name"] == "add_order"


async def test_mock_tts_returns_pcm_bytes():
    tts = MockTTS()
    data = await tts.synthesize("おはよう", language="ja")
    assert isinstance(data, bytes) and len(data) > 0
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `services/__init__.py` (empty)**

- [ ] **Step 4: Write `services/interfaces.py`**

```python
# voice-agent-conoha-l4/agent/app/services/interfaces.py
"""Protocol interfaces — mock and real implementations satisfy these."""
from typing import Any, Protocol


class STT(Protocol):
    async def transcribe(self, pcm16: bytes) -> tuple[str, str]:
        """Return (text, detected_language)."""


class LLM(Protocol):
    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str = "auto",
    ) -> dict[str, Any]:
        """Return an OpenAI-shape assistant message dict."""


class TTS(Protocol):
    async def synthesize(self, text: str, language: str) -> bytes:
        """Return 16-bit PCM mono @ 24000 Hz."""
```

- [ ] **Step 5: Write `services/mocks.py`**

```python
# voice-agent-conoha-l4/agent/app/services/mocks.py
"""Deterministic in-memory mocks for non-GPU test environments."""
import json
import struct


class MockSTT:
    def __init__(self, transcript: str = "親子丼を1つ", language: str = "ja"):
        self._t = transcript
        self._l = language

    async def transcribe(self, pcm16: bytes) -> tuple[str, str]:
        return self._t, self._l


class MockLLM:
    """Always emits an add_order tool_call for any non-empty user content."""

    async def chat(self, messages, tools, tool_choice="auto"):
        last_user = next((m for m in reversed(messages) if m["role"] == "user"), None)
        if not last_user:
            return {"role": "assistant", "content": "..."}
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": "call_mock",
                "type": "function",
                "function": {
                    "name": "add_order",
                    "arguments": json.dumps({
                        "items": [{"name": "親子丼", "qty": 1}],
                        "language": "ja",
                    }),
                },
            }],
        }


class MockTTS:
    async def synthesize(self, text: str, language: str) -> bytes:
        # 100ms of silence at 24000 Hz, 16-bit mono.
        return struct.pack("<" + "h" * 2400, *([0] * 2400))
```

- [ ] **Step 6: Run tests — expect pass**

```bash
pytest app/tests/test_mock_services.py -v
```

- [ ] **Step 7: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/services/ voice-agent-conoha-l4/agent/app/tests/test_mock_services.py
git commit -m "feat(agent): add service Protocols and mock STT/LLM/TTS"
```

## Task 18: Agent conversation loop using injected services

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/loop.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_loop.py`

This module is the **pure-Python core** of the agent — it owns the message
history, calls injected STT/LLM/TTS services, and dispatches tool calls
via the `ToolExecutor`. The Pipecat/aiortc wrapper (Task 20) only adapts
audio frames in/out around this core. Unit-testing this in isolation
gives us strong guarantees without GPU dependencies.

- [ ] **Step 1: Write failing tests**

```python
# voice-agent-conoha-l4/agent/app/tests/test_loop.py
import json

import pytest

from app.loop import ConversationLoop
from app.services.mocks import MockLLM, MockSTT, MockTTS

pytestmark = pytest.mark.asyncio


class CapturingLLM(MockLLM):
    """LLM that emits tool_call on first turn, plain text on second."""
    def __init__(self):
        self._call = 0
        self.captured_messages = []

    async def chat(self, messages, tools, tool_choice="auto"):
        self.captured_messages.append(list(messages))
        self._call += 1
        if self._call == 1:
            return await super().chat(messages, tools, tool_choice)
        return {"role": "assistant",
                "content": "親子丼を1つ承りました。10 分ほどお待ちください。"}


async def test_loop_runs_tool_then_final_answer(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders",
        method="POST",
        json={"order_id": "ord_xyz", "items": [{"name": "親子丼", "qty": 1}],
              "mode": "callcenter", "language": "ja", "customer_label": None,
              "notes": None, "status": "persisted",
              "created_at": "t", "updated_at": "t"},
    )
    llm = CapturingLLM()
    loop = ConversationLoop(
        mode="callcenter", stt=MockSTT(), llm=llm, tts=MockTTS(),
    )
    events = []
    audio = await loop.turn(pcm16=b"\x00\x00", emit=events.append)
    assert isinstance(audio, bytes) and len(audio) > 0
    types = [e["type"] for e in events]
    assert "user_transcript" in types
    assert "tool_call" in types
    assert "order_persisted" in types
    # LLM was called twice: once for tool decision, once for final response.
    assert len(llm.captured_messages) == 2
    # Second call must include tool_result message.
    tool_msgs = [m for m in llm.captured_messages[1] if m["role"] == "tool"]
    assert len(tool_msgs) == 1
    assert json.loads(tool_msgs[0]["content"])["order_id"] == "ord_xyz"
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `loop.py`**

```python
# voice-agent-conoha-l4/agent/app/loop.py
"""Pure conversation loop: STT → LLM (with tool execution) → TTS.

GPU services and aiortc audio plumbing are injected, so this module can
be unit-tested without either. The Pipecat/WebRTC adapter wraps a
single instance of this loop per session.
"""
import json
import logging
from typing import Any, Callable

from app.personas import resolve
from app.services.interfaces import LLM, STT, TTS
from app.tools import OPENAI_TOOLS, ToolExecutor

logger = logging.getLogger(__name__)


class ConversationLoop:
    def __init__(
        self,
        mode: str,
        stt: STT,
        llm: LLM,
        tts: TTS,
        tool_executor: ToolExecutor | None = None,
    ) -> None:
        self._mode, system_prompt = resolve(mode)
        self._history: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._exec = tool_executor or ToolExecutor(mode=self._mode)

    async def turn(
        self,
        pcm16: bytes,
        emit: Callable[[dict[str, Any]], None],
    ) -> bytes:
        text, lang = await self._stt.transcribe(pcm16)
        if not text.strip():
            audio = await self._tts.synthesize(
                "もう一度お願いします。", language="ja"
            )
            emit({"type": "empty_transcript"})
            return audio

        emit({"type": "user_transcript", "text": text, "language": lang})
        self._history.append({"role": "user", "content": text})

        assistant_msg = await self._llm.chat(
            messages=self._history, tools=OPENAI_TOOLS, tool_choice="auto"
        )
        self._history.append(assistant_msg)

        if assistant_msg.get("tool_calls"):
            for call in assistant_msg["tool_calls"]:
                name = call["function"]["name"]
                args = json.loads(call["function"]["arguments"])
                emit({"type": "tool_call", "name": name, "args": args})
                try:
                    result = await self._exec.dispatch(name, args)
                    if name == "add_order" and result.get("ok"):
                        emit({
                            "type": "order_persisted",
                            "order_id": result["order_id"],
                        })
                except Exception as exc:
                    logger.exception("tool dispatch failed")
                    result = {"ok": False, "error": str(exc)}
                    emit({"type": "error", "detail": str(exc)})
                self._history.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps(result),
                })

            final = await self._llm.chat(
                messages=self._history, tools=OPENAI_TOOLS, tool_choice="auto"
            )
            self._history.append(final)
            content = final.get("content") or ""
        else:
            content = assistant_msg.get("content") or ""

        if content:
            emit({"type": "assistant_text", "text": content})
        return await self._tts.synthesize(content or "...", language=lang)
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest app/tests/test_loop.py -v
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/loop.py voice-agent-conoha-l4/agent/app/tests/test_loop.py
git commit -m "feat(agent): add pure ConversationLoop with injected services"
```

## Task 19: Agent FastAPI app with /healthz, /modes, /offer (mock pipeline wired)

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/transport.py`
- Create: `voice-agent-conoha-l4/agent/app/server.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_server.py`

For Phase C we wire `/offer` against an aiortc PeerConnection but use
mock STT/LLM/TTS — the SDP exchange itself is real, the GPU services
are stubbed.

- [ ] **Step 1: Write failing tests for `/healthz`, `/modes`, and unhappy-path /offer**

```python
# voice-agent-conoha-l4/agent/app/tests/test_server.py
import pytest
from fastapi.testclient import TestClient

from app.server import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "")
    monkeypatch.setenv("MAX_CONCURRENT_SESSIONS", "1")
    import importlib
    from app import settings
    importlib.reload(settings)
    app = create_app(use_mock_services=True)
    return TestClient(app)


def test_healthz_starts_503(client):
    # Mock services warm up instantly, but /healthz only flips after lifespan
    # has run. TestClient's `with` form triggers lifespan; without it, state
    # is uninitialised → 503.
    resp = client.get("/healthz")
    assert resp.status_code == 200  # mocks are ready immediately
    assert resp.json()["ok"] is True


def test_modes_endpoint(client):
    r = client.get("/modes")
    assert r.status_code == 200
    assert set(r.json()["modes"]) == {"emergency", "military", "callcenter"}


def test_offer_unknown_mode_rejected(client):
    r = client.post("/offer", json={"sdp": "v=0\r\n", "type": "offer", "mode": "intergalactic"})
    assert r.status_code == 422
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Write `transport.py` (aiortc handshake — kept minimal; full pipeline wiring in Phase D)**

```python
# voice-agent-conoha-l4/agent/app/transport.py
"""WebRTC offer/answer handshake via aiortc.

The actual audio<->ConversationLoop wiring is plugged in by Phase D. For
Phase C this module just establishes a PeerConnection, opens a
DataChannel, and immediately closes it — enough to verify the wire
contract from the frontend side.
"""
import logging
import uuid
from dataclasses import dataclass

from aiortc import RTCPeerConnection, RTCSessionDescription

logger = logging.getLogger(__name__)


@dataclass
class OfferResult:
    sdp: str
    type: str
    session_id: str


class WebRTCNegotiator:
    """Per-app singleton that holds active PeerConnections."""

    def __init__(self) -> None:
        self._pcs: dict[str, RTCPeerConnection] = {}

    async def handle_offer(self, sdp: str, sdp_type: str) -> OfferResult:
        pc = RTCPeerConnection()
        sid = uuid.uuid4().hex

        @pc.on("connectionstatechange")
        async def on_state():
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self.close(sid)

        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=sdp_type))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        self._pcs[sid] = pc
        return OfferResult(sdp=pc.localDescription.sdp, type=pc.localDescription.type,
                           session_id=sid)

    async def close(self, session_id: str) -> None:
        pc = self._pcs.pop(session_id, None)
        if pc is not None:
            await pc.close()

    async def close_all(self) -> None:
        for pc in list(self._pcs.values()):
            await pc.close()
        self._pcs.clear()
```

- [ ] **Step 4: Write `server.py`**

```python
# voice-agent-conoha-l4/agent/app/server.py
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app import settings
from app.personas import PERSONAS
from app.security import OfferRateLimitMiddleware, OriginGuardMiddleware
from app.services.mocks import MockLLM, MockSTT, MockTTS
from app.sessions import SessionRegistry
from app.transport import WebRTCNegotiator


Mode = Literal["emergency", "military", "callcenter"]


class OfferRequest(BaseModel):
    sdp: str
    type: str
    mode: Mode


class OfferResponse(BaseModel):
    sdp: str
    type: str
    session_id: str


def create_app(use_mock_services: bool = False) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessions = SessionRegistry(max_sessions=settings.MAX_CONCURRENT_SESSIONS)
        app.state.negotiator = WebRTCNegotiator()
        if use_mock_services:
            app.state.stt, app.state.llm, app.state.tts = MockSTT(), MockLLM(), MockTTS()
            app.state.ready = True
        else:
            # Real services wired in Phase D
            app.state.stt = app.state.llm = app.state.tts = None
            app.state.ready = False
        yield
        await app.state.negotiator.close_all()

    app = FastAPI(title="voice-agent-conoha-l4-agent", lifespan=lifespan)
    app.add_middleware(OfferRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)

    @app.get("/healthz")
    async def healthz():
        if not app.state.ready:
            raise HTTPException(status_code=503, detail="warming up")
        return {"ok": True}

    @app.get("/modes")
    async def modes():
        return {"modes": list(PERSONAS.keys())}

    @app.post("/offer", response_model=OfferResponse)
    async def offer(req: OfferRequest):
        if not app.state.sessions.acquire(_provisional_id := "tmp"):
            raise HTTPException(status_code=503, detail="too many sessions")
        try:
            result = await app.state.negotiator.handle_offer(req.sdp, req.type)
        except Exception:
            app.state.sessions.release(_provisional_id)
            raise
        # Replace the provisional reservation with the real session id.
        app.state.sessions.release(_provisional_id)
        app.state.sessions.acquire(result.session_id)
        return OfferResponse(sdp=result.sdp, type=result.type,
                             session_id=result.session_id)

    return app


app = create_app(use_mock_services=False)
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pytest app/tests/test_server.py -v
```

- [ ] **Step 6: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/transport.py voice-agent-conoha-l4/agent/app/server.py voice-agent-conoha-l4/agent/app/tests/test_server.py
git commit -m "feat(agent): wire FastAPI /healthz /modes /offer with aiortc handshake"
```

---

# Phase D — GPU services integration (test on actual GPU)

These tasks integrate real GPU-backed services and require a GPU host.
All tests in this phase are marked `@pytest.mark.gpu` and skipped in CI.

## Task 20: Real LLM service (vLLM client via OpenAI SDK)

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/services/llm.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_llm_real.py`

- [ ] **Step 1: Write GPU-marked integration test**

```python
# voice-agent-conoha-l4/agent/app/tests/test_llm_real.py
import json
import pytest

from app.services.llm import VLLMService
from app.tools import OPENAI_TOOLS

pytestmark = pytest.mark.gpu


@pytest.mark.asyncio
async def test_qwen_emits_add_order_for_japanese_request():
    llm = VLLMService(base_url="http://localhost:8000/v1",
                       model="Qwen/Qwen2.5-7B-Instruct-AWQ")
    out = await llm.chat(
        messages=[
            {"role": "system",
             "content": "あなたは食堂のスタッフ。注文があれば add_order を呼ぶ。"},
            {"role": "user", "content": "親子丼を1つください"},
        ],
        tools=OPENAI_TOOLS,
        tool_choice="auto",
    )
    assert out["tool_calls"], f"expected tool_call, got: {out}"
    call = out["tool_calls"][0]["function"]
    assert call["name"] == "add_order"
    args = json.loads(call["arguments"])
    assert any("親子丼" in i["name"] for i in args["items"])
```

- [ ] **Step 2: Write `services/llm.py`**

```python
# voice-agent-conoha-l4/agent/app/services/llm.py
from typing import Any

from openai import AsyncOpenAI


class VLLMService:
    def __init__(self, base_url: str, model: str, api_key: str = "EMPTY") -> None:
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str = "auto",
    ) -> dict[str, Any]:
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            temperature=0.2,
            max_tokens=512,
        )
        msg = resp.choices[0].message
        out: dict[str, Any] = {"role": "assistant", "content": msg.content}
        if msg.tool_calls:
            out["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ]
        return out
```

- [ ] **Step 3: Run (requires vLLM running on localhost:8000 with Qwen2.5-7B-AWQ)**

```bash
pytest -m gpu app/tests/test_llm_real.py -v
```

Expected (when GPU+vLLM available): PASS.

- [ ] **Step 4: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/services/llm.py voice-agent-conoha-l4/agent/app/tests/test_llm_real.py
git commit -m "feat(agent): add VLLMService backed by OpenAI SDK"
```

## Task 21: Real STT service (faster-whisper)

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/services/stt.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_stt_real.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/fixtures/oyakodon_ja.wav` (record manually, ~3 s, "親子丼を1つお願いします")

- [ ] **Step 1: Write GPU-marked test**

```python
# voice-agent-conoha-l4/agent/app/tests/test_stt_real.py
from pathlib import Path

import pytest
import soundfile as sf

from app.services.stt import WhisperSTTService

pytestmark = pytest.mark.gpu


@pytest.mark.asyncio
async def test_japanese_transcription():
    wav_path = Path(__file__).parent / "fixtures" / "oyakodon_ja.wav"
    data, sr = sf.read(wav_path, dtype="int16")
    assert sr == 16000
    stt = WhisperSTTService(model_size="medium", device="cuda")
    text, lang = await stt.transcribe(data.tobytes())
    assert "親子" in text or "親子丼" in text
    assert lang == "ja"
```

- [ ] **Step 2: Write `services/stt.py`**

```python
# voice-agent-conoha-l4/agent/app/services/stt.py
import asyncio
import io

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel


class WhisperSTTService:
    def __init__(self, model_size: str = "medium", device: str = "cuda") -> None:
        self._model = WhisperModel(model_size, device=device, compute_type="float16")

    async def transcribe(self, pcm16: bytes) -> tuple[str, str]:
        return await asyncio.get_event_loop().run_in_executor(
            None, self._transcribe_sync, pcm16
        )

    def _transcribe_sync(self, pcm16: bytes) -> tuple[str, str]:
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        segments, info = self._model.transcribe(
            audio, language=None, beam_size=1, vad_filter=False
        )
        text = "".join(s.text for s in segments).strip()
        return text, info.language
```

- [ ] **Step 3: Record fixture WAV** (manual step on a workstation; commit binary)

```bash
# Outside-of-plan manual step. Result: 3s 16kHz mono PCM WAV saying "親子丼を1つお願いします".
# Place at voice-agent-conoha-l4/agent/app/tests/fixtures/oyakodon_ja.wav
```

- [ ] **Step 4: Run GPU test**

```bash
pytest -m gpu app/tests/test_stt_real.py -v
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/services/stt.py voice-agent-conoha-l4/agent/app/tests/test_stt_real.py voice-agent-conoha-l4/agent/app/tests/fixtures/oyakodon_ja.wav
git commit -m "feat(agent): add WhisperSTTService (faster-whisper)"
```

## Task 22: Real TTS service (Style-BERT-VITS2)

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/services/tts.py`
- Create: `voice-agent-conoha-l4/agent/app/tests/test_tts_real.py`

- [ ] **Step 1: Write GPU-marked test**

```python
# voice-agent-conoha-l4/agent/app/tests/test_tts_real.py
import pytest

from app.services.tts import SBV2TTSService

pytestmark = pytest.mark.gpu


@pytest.mark.asyncio
async def test_synthesize_returns_pcm():
    tts = SBV2TTSService(model_dir="/models/sbv2", device="cuda")
    pcm = await tts.synthesize("親子丼を1つ承りました。", language="ja")
    assert isinstance(pcm, bytes)
    # Roughly 1-2 s of audio @ 24kHz, 16-bit mono
    assert 20_000 < len(pcm) < 200_000
```

- [ ] **Step 2: Write `services/tts.py`**

```python
# voice-agent-conoha-l4/agent/app/services/tts.py
import asyncio
import io
from pathlib import Path

import numpy as np
import soundfile as sf
from style_bert_vits2.tts_model import TTSModel
from style_bert_vits2.nlp import bert_models
from style_bert_vits2.constants import Languages


class SBV2TTSService:
    def __init__(self, model_dir: str, device: str = "cuda") -> None:
        # SBV2 requires BERT model preload for Japanese.
        bert_models.load_model(Languages.JP, "ku-nlp/deberta-v2-large-japanese-char-wwm")
        bert_models.load_tokenizer(Languages.JP, "ku-nlp/deberta-v2-large-japanese-char-wwm")
        model_path = Path(model_dir)
        # Convention: one .safetensors + one config.json + one style_vectors.npy per voice
        weight = next(model_path.glob("*.safetensors"))
        config = model_path / "config.json"
        style = model_path / "style_vectors.npy"
        self._model = TTSModel(model_path=weight, config_path=config,
                               style_vec_path=style, device=device)

    async def synthesize(self, text: str, language: str) -> bytes:
        return await asyncio.get_event_loop().run_in_executor(
            None, self._synth_sync, text
        )

    def _synth_sync(self, text: str) -> bytes:
        sr, audio = self._model.infer(text=text, language=Languages.JP)
        # audio: numpy float32 [-1,1]. Resample/convert to int16 24000Hz.
        if sr != 24000:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=24000)
        pcm16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
        return pcm16.tobytes()
```

- [ ] **Step 3: Run GPU test (requires `/models/sbv2/` populated)**

```bash
pytest -m gpu app/tests/test_tts_real.py -v
```

- [ ] **Step 4: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/services/tts.py voice-agent-conoha-l4/agent/app/tests/test_tts_real.py
git commit -m "feat(agent): add SBV2TTSService"
```

## Task 23: Wire real services into server.py + warmup gate on /healthz

**Files:**
- Modify: `voice-agent-conoha-l4/agent/app/server.py`

- [ ] **Step 1: Update `server.py` to load real services in lifespan when not in mock mode**

Replace the `lifespan` function:

```python
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessions = SessionRegistry(max_sessions=settings.MAX_CONCURRENT_SESSIONS)
        app.state.negotiator = WebRTCNegotiator()
        app.state.ready = False
        if use_mock_services:
            app.state.stt, app.state.llm, app.state.tts = MockSTT(), MockLLM(), MockTTS()
            app.state.ready = True
        else:
            from app.services.llm import VLLMService
            from app.services.stt import WhisperSTTService
            from app.services.tts import SBV2TTSService
            app.state.stt = WhisperSTTService(model_size=settings.WHISPER_MODEL_SIZE)
            app.state.llm = VLLMService(base_url=settings.LLM_URL, model=settings.LLM_MODEL)
            app.state.tts = SBV2TTSService(model_dir=settings.SBV2_MODEL_DIR)
            # Best-effort warmup. /healthz remains 503 if any of these throws.
            try:
                await app.state.stt.transcribe(b"\x00" * 1600)  # 100ms silence @16k
                await app.state.llm.chat(
                    messages=[{"role": "user", "content": "warmup"}],
                    tools=[], tool_choice="none",
                )
                await app.state.tts.synthesize("起動完了", language="ja")
                app.state.ready = True
            except Exception:
                import logging
                logging.exception("warmup failed")
                app.state.ready = False
        yield
        await app.state.negotiator.close_all()
```

- [ ] **Step 2: Run mock-mode tests to ensure regression-free**

```bash
pytest app/tests/test_server.py -v
```

- [ ] **Step 3: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/server.py
git commit -m "feat(agent): wire real STT/LLM/TTS services with warmup gate"
```

## Task 24: Pipecat pipeline binding ConversationLoop to WebRTC audio frames

**Files:**
- Create: `voice-agent-conoha-l4/agent/app/pipeline.py`
- Modify: `voice-agent-conoha-l4/agent/app/transport.py` (use pipeline)
- Modify: `voice-agent-conoha-l4/agent/app/server.py` (pass services to negotiator)

For this sample we use **aiortc directly** rather than a heavyweight
Pipecat transport — the pipeline reduces to (1) accumulate incoming
audio frames until VAD signals end-of-utterance, (2) call
`ConversationLoop.turn(...)`, (3) push the returned PCM to the outbound
audio track. This keeps the dependency surface small. Silero VAD is
loaded directly via torch.

- [ ] **Step 1: Write `pipeline.py`**

```python
# voice-agent-conoha-l4/agent/app/pipeline.py
"""Glues WebRTC audio I/O to ConversationLoop using Silero VAD for
turn detection.

Inbound audio frames arrive at 48 kHz (Opus default). We resample to
16 kHz mono for Whisper. Outbound audio from TTS arrives at 24 kHz; we
upsample to 48 kHz for the WebRTC AudioStreamTrack.
"""
import asyncio
import fractions
import logging
from typing import Callable

import av
import numpy as np
import torch
from aiortc.mediastreams import AudioStreamTrack
from aiortc.contrib.media import MediaStreamError

from app.loop import ConversationLoop

logger = logging.getLogger(__name__)
_SILERO_REPO = "snakers4/silero-vad"


class _OutboundTrack(AudioStreamTrack):
    """Audio track fed from an asyncio.Queue of 48 kHz int16 PCM chunks."""

    def __init__(self) -> None:
        super().__init__()
        self._queue: asyncio.Queue[np.ndarray] = asyncio.Queue()
        self._pts = 0

    async def push(self, pcm48k_int16: np.ndarray) -> None:
        await self._queue.put(pcm48k_int16)

    async def recv(self):
        try:
            data = await asyncio.wait_for(self._queue.get(), timeout=0.05)
        except asyncio.TimeoutError:
            # Emit 20 ms of silence so the track stays alive.
            data = np.zeros(960, dtype=np.int16)
        frame = av.AudioFrame.from_ndarray(data.reshape(1, -1), format="s16",
                                            layout="mono")
        frame.sample_rate = 48000
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, 48000)
        self._pts += data.shape[-1]
        return frame


def _resample_int16(pcm: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return pcm
    import librosa
    f = pcm.astype(np.float32) / 32768.0
    f = librosa.resample(f, orig_sr=src_sr, target_sr=dst_sr)
    return (np.clip(f, -1.0, 1.0) * 32767).astype(np.int16)


class VoicePipeline:
    """One per session. Owns the VAD state and the ConversationLoop."""

    SILENCE_THRESHOLD_SEC = 0.6
    MAX_UTTERANCE_SEC = 20.0
    VAD_PROB_THRESHOLD = 0.5

    def __init__(self, loop: ConversationLoop, emit: Callable[[dict], None]) -> None:
        self._loop = loop
        self._emit = emit
        self._buf: list[np.ndarray] = []
        self._speech_active = False
        self._silence_samples = 0
        self._out_track = _OutboundTrack()
        # Silero VAD operates on 16 kHz 30 ms chunks (480 samples)
        self._vad_model, _ = torch.hub.load(repo_or_dir=_SILERO_REPO,
                                              model="silero_vad", trust_repo=True)

    def outbound_track(self) -> _OutboundTrack:
        return self._out_track

    async def handle_inbound_track(self, track) -> None:
        try:
            while True:
                frame = await track.recv()
                arr = frame.to_ndarray()
                if arr.ndim > 1:
                    arr = arr.mean(axis=0).astype(np.int16)
                pcm16k = _resample_int16(arr, frame.sample_rate, 16000)
                await self._process_chunk(pcm16k)
        except MediaStreamError:
            return

    async def _process_chunk(self, pcm16k: np.ndarray) -> None:
        self._buf.append(pcm16k)
        # Run VAD on the most recent 30 ms (480 samples)
        recent = pcm16k[-480:] if pcm16k.size >= 480 else pcm16k
        if recent.size < 480:
            return
        tensor = torch.from_numpy(recent.astype(np.float32) / 32768.0)
        prob = float(self._vad_model(tensor, 16000).item())

        if prob >= self.VAD_PROB_THRESHOLD:
            self._speech_active = True
            self._silence_samples = 0
        elif self._speech_active:
            self._silence_samples += recent.size
            if self._silence_samples / 16000 >= self.SILENCE_THRESHOLD_SEC:
                await self._flush_utterance()

    async def _flush_utterance(self) -> None:
        if not self._buf:
            return
        utterance = np.concatenate(self._buf)
        self._buf = []
        self._speech_active = False
        self._silence_samples = 0
        try:
            pcm24k_out = await self._loop.turn(
                pcm16=utterance.tobytes(), emit=self._emit
            )
        except Exception:
            logger.exception("conversation turn failed")
            self._emit({"type": "error", "detail": "turn failed"})
            return
        arr24k = np.frombuffer(pcm24k_out, dtype=np.int16)
        arr48k = _resample_int16(arr24k, 24000, 48000)
        # Push in 20 ms chunks (960 samples @ 48 kHz)
        chunk = 960
        for i in range(0, arr48k.size, chunk):
            await self._out_track.push(arr48k[i:i + chunk])
```

- [ ] **Step 2: Update `transport.py` to construct a pipeline per offer and attach tracks**

Replace `WebRTCNegotiator.handle_offer`:

```python
import json

from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamError

from app.loop import ConversationLoop
from app.pipeline import VoicePipeline


class WebRTCNegotiator:
    def __init__(self, services_factory) -> None:
        self._pcs: dict[str, RTCPeerConnection] = {}
        self._pipelines: dict[str, VoicePipeline] = {}
        self._services_factory = services_factory  # callable → (stt, llm, tts)

    async def handle_offer(self, sdp: str, sdp_type: str, mode: str) -> OfferResult:
        pc = RTCPeerConnection()
        sid = uuid.uuid4().hex
        stt, llm, tts = self._services_factory()
        conv = ConversationLoop(mode=mode, stt=stt, llm=llm, tts=tts)
        dc = pc.createDataChannel("ui-events")

        def emit(event: dict) -> None:
            if dc.readyState == "open":
                dc.send(json.dumps(event))

        pipeline = VoicePipeline(conv, emit=emit)
        pc.addTrack(pipeline.outbound_track())

        @pc.on("track")
        def on_track(track):
            if track.kind == "audio":
                asyncio.create_task(pipeline.handle_inbound_track(track))

        @pc.on("connectionstatechange")
        async def on_state():
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self.close(sid)

        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=sdp_type))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        self._pcs[sid] = pc
        self._pipelines[sid] = pipeline
        return OfferResult(sdp=pc.localDescription.sdp,
                           type=pc.localDescription.type,
                           session_id=sid)

    async def close(self, session_id: str) -> None:
        pc = self._pcs.pop(session_id, None)
        self._pipelines.pop(session_id, None)
        if pc is not None:
            await pc.close()

    async def close_all(self) -> None:
        for pc in list(self._pcs.values()):
            await pc.close()
        self._pcs.clear()
        self._pipelines.clear()
```

- [ ] **Step 3: Update `server.py` to pass a `services_factory` and forward `mode` to `handle_offer`**

Modify `offer()` and `lifespan` accordingly:

```python
        def services_factory():
            return app.state.stt, app.state.llm, app.state.tts
        app.state.negotiator = WebRTCNegotiator(services_factory=services_factory)

    # ...
    @app.post("/offer", response_model=OfferResponse)
    async def offer(req: OfferRequest):
        if not app.state.ready:
            raise HTTPException(status_code=503, detail="warming up")
        if app.state.sessions.count() >= settings.MAX_CONCURRENT_SESSIONS:
            raise HTTPException(status_code=503, detail="too many sessions")
        result = await app.state.negotiator.handle_offer(req.sdp, req.type, req.mode)
        app.state.sessions.acquire(result.session_id)
        return OfferResponse(sdp=result.sdp, type=result.type,
                             session_id=result.session_id)
```

- [ ] **Step 4: Run mock-mode test suite (no GPU needed)**

```bash
pytest app/ -m "not gpu" -v
```

Expected: all non-GPU tests pass.

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/agent/app/pipeline.py voice-agent-conoha-l4/agent/app/transport.py voice-agent-conoha-l4/agent/app/server.py
git commit -m "feat(agent): wire WebRTC pipeline with Silero VAD + ConversationLoop"
```

## Task 25: Agent Dockerfile (CUDA base)

**Files:**
- Create: `voice-agent-conoha-l4/agent/Dockerfile`
- Create: `voice-agent-conoha-l4/agent/.dockerignore`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# voice-agent-conoha-l4/agent/Dockerfile
FROM nvidia/cuda:12.4.1-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    TORCH_HOME=/models/torch

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3-pip \
      ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY app/ ./app/

# Pre-download Silero VAD weights at build time so cold start doesn't hit network.
RUN python3.12 -c "import torch; torch.hub.load('snakers4/silero-vad', 'silero_vad', trust_repo=True)"

USER ubuntu
EXPOSE 8080
CMD ["uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
__pycache__/
*.pyc
.venv/
.pytest_cache/
.ruff_cache/
*.egg-info/
app/tests/
```

- [ ] **Step 3: Build image (slow — large CUDA layer)**

```bash
cd voice-agent-conoha-l4/agent && docker build -t voice-agent-agent:dev .
```

- [ ] **Step 4: Commit**

```bash
git add voice-agent-conoha-l4/agent/Dockerfile voice-agent-conoha-l4/agent/.dockerignore
git commit -m "feat(agent): add Dockerfile (CUDA 12.4 base)"
```

## Task 26: llm container (vLLM)

**Files:**
- Create: `voice-agent-conoha-l4/llm/Dockerfile`
- Create: `voice-agent-conoha-l4/llm/entrypoint.sh`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# voice-agent-conoha-l4/llm/Dockerfile
FROM vllm/vllm-openai:v0.6.4.post1

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV LLM_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ \
    GPU_MEMORY_UTILIZATION=0.40 \
    MAX_MODEL_LEN=4096

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Write `entrypoint.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

exec python3 -m vllm.entrypoints.openai.api_server \
  --host 0.0.0.0 \
  --port 8000 \
  --model "${LLM_MODEL}" \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --quantization awq_marlin \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

- [ ] **Step 3: Build**

```bash
cd voice-agent-conoha-l4/llm && docker build -t voice-agent-llm:dev .
```

- [ ] **Step 4: Commit**

```bash
git add voice-agent-conoha-l4/llm/Dockerfile voice-agent-conoha-l4/llm/entrypoint.sh
git commit -m "feat(llm): add vLLM container with Qwen2.5-7B-AWQ + Hermes tool parser"
```

---

# Phase E — Frontend

## Task 27: Next.js 16 scaffold

**Files:**
- Create: `voice-agent-conoha-l4/frontend/package.json`
- Create: `voice-agent-conoha-l4/frontend/tsconfig.json`
- Create: `voice-agent-conoha-l4/frontend/next.config.mjs`
- Create: `voice-agent-conoha-l4/frontend/postcss.config.mjs`
- Create: `voice-agent-conoha-l4/frontend/tailwind.config.ts`
- Create: `voice-agent-conoha-l4/frontend/app/globals.css`
- Create: `voice-agent-conoha-l4/frontend/.dockerignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "voice-agent-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "16.0.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "qrcode": "1.5.4"
  },
  "devDependencies": {
    "@types/node": "22.10.0",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "@types/qrcode": "1.5.5",
    "autoprefixer": "10.4.20",
    "postcss": "8.5.0",
    "tailwindcss": "3.4.17",
    "typescript": "5.7.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
};
export default nextConfig;
```

- [ ] **Step 4: Write `postcss.config.mjs`**

```js
const config = { plugins: { tailwindcss: {}, autoprefixer: {} } };
export default config;
```

- [ ] **Step 5: Write `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};
export default config;
```

- [ ] **Step 6: Write `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { @apply bg-zinc-950 text-zinc-100; }
```

- [ ] **Step 7: Write `.dockerignore`**

```
node_modules
.next
.git
```

- [ ] **Step 8: Install + build sanity check**

```bash
cd voice-agent-conoha-l4/frontend && npm install && npx next build
```

Expected: build completes (with no pages defined yet next produces a near-empty app).

- [ ] **Step 9: Commit**

```bash
git add voice-agent-conoha-l4/frontend/
git commit -m "feat(frontend): scaffold Next.js 16 project"
```

## Task 28: Frontend types

**Files:**
- Create: `voice-agent-conoha-l4/frontend/lib/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
// voice-agent-conoha-l4/frontend/lib/types.ts
export type Mode = "emergency" | "military" | "callcenter";
export type Language = "ja" | "en" | "ko";
export type OrderStatus = "pending" | "persisted" | "closed" | "error";

export interface OrderItem {
  name: string;
  qty: number;
  note?: string | null;
}

export interface Order {
  order_id: string;
  mode: Mode;
  language: Language;
  customer_label: string | null;
  items: OrderItem[];
  notes: string | null;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

export const MODES: { mode: Mode; emoji: string; label: string }[] = [
  { mode: "emergency",  emoji: "🚑", label: "救急センター" },
  { mode: "military",   emoji: "🪖", label: "作戦司令部" },
  { mode: "callcenter", emoji: "☎️", label: "コールセンター" },
];
```

- [ ] **Step 2: Commit**

```bash
git add voice-agent-conoha-l4/frontend/lib/types.ts
git commit -m "feat(frontend): add shared TypeScript types"
```

## Task 29: Frontend QR page

**Files:**
- Create: `voice-agent-conoha-l4/frontend/app/layout.tsx`
- Create: `voice-agent-conoha-l4/frontend/app/page.tsx`

- [ ] **Step 1: Write `app/layout.tsx`**

```tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "voice-agent-conoha-l4",
  description: "Self-hosted WebRTC voice agent on ConoHa L4 GPU",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Write `app/page.tsx`**

```tsx
import QRCode from "qrcode";
import { MODES } from "@/lib/types";

async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 320 });
}

export default async function HomePage() {
  // Use the request's host at build/runtime via headers().
  const base = process.env.PUBLIC_BASE_URL ?? "";
  const cards = await Promise.all(
    MODES.map(async (m) => ({
      ...m,
      url: `${base}/talk?mode=${m.mode}`,
      qr: await qrDataUrl(`${base}/talk?mode=${m.mode}`),
    }))
  );

  return (
    <main className="min-h-screen p-8 flex flex-col items-center gap-8">
      <h1 className="text-3xl font-bold">音声エージェント・デモ</h1>
      <p className="opacity-70">QR をスキャンしてモードを選択</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        {cards.map((c) => (
          <a
            key={c.mode}
            href={c.url}
            className="bg-zinc-900 rounded-2xl p-6 flex flex-col items-center gap-3 hover:bg-zinc-800 transition"
          >
            <div className="text-5xl">{c.emoji}</div>
            <div className="text-xl font-semibold">{c.label}</div>
            <img src={c.qr} alt={c.label} className="rounded bg-white p-2" />
            <code className="text-xs opacity-60">mode={c.mode}</code>
          </a>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Build sanity check**

```bash
PUBLIC_BASE_URL=https://example.test npx next build
```

- [ ] **Step 4: Commit**

```bash
git add voice-agent-conoha-l4/frontend/app/layout.tsx voice-agent-conoha-l4/frontend/app/page.tsx
git commit -m "feat(frontend): add QR landing page"
```

## Task 30: Frontend voice.ts (WebRTC client)

**Files:**
- Create: `voice-agent-conoha-l4/frontend/lib/voice.ts`

- [ ] **Step 1: Write `voice.ts`**

```ts
// voice-agent-conoha-l4/frontend/lib/voice.ts
import type { Mode } from "@/lib/types";

export interface VoiceSession {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  audioEl: HTMLAudioElement;
  micTrack: MediaStreamTrack;
  sessionId: string;
}

export type AgentEvent =
  | { type: "user_transcript"; text: string; language: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "order_persisted"; order_id: string }
  | { type: "empty_transcript" }
  | { type: "error"; detail: string };

export async function startVoice(
  mode: Mode,
  onEvent: (e: AgentEvent) => void,
): Promise<VoiceSession> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = (e) => {
    audioEl.srcObject = e.streams[0];
  };

  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const micTrack = mic.getAudioTracks()[0];
  pc.addTrack(micTrack, mic);

  const dc = pc.createDataChannel("ui-events");
  let resolveSession: (s: VoiceSession) => void;
  const ready = new Promise<VoiceSession>((r) => { resolveSession = r; });

  dc.addEventListener("message", (e) => {
    try {
      onEvent(JSON.parse(e.data) as AgentEvent);
    } catch {
      // ignore malformed
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const resp = await fetch("/api/offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: offer.sdp, type: offer.type, mode }),
  });
  if (!resp.ok) throw new Error(`offer failed: ${resp.status}`);
  const ans = await resp.json() as { sdp: string; type: string; session_id: string };
  await pc.setRemoteDescription({ type: ans.type as RTCSdpType, sdp: ans.sdp });

  const session: VoiceSession = { pc, dc, audioEl, micTrack, sessionId: ans.session_id };
  resolveSession!(session);
  return session;
}

export function closeVoice(s: VoiceSession): void {
  s.micTrack.stop();
  try { s.dc.close(); } catch {}
  s.pc.close();
}
```

- [ ] **Step 2: Note Next.js rewrite required for `/api/offer` → agent** (handled in Task 33 nginx-style proxy via Next's `rewrites()`)

- [ ] **Step 3: Commit**

```bash
git add voice-agent-conoha-l4/frontend/lib/voice.ts
git commit -m "feat(frontend): add minimal WebRTC client (voice.ts)"
```

## Task 31: Frontend talk page (VAD indicator UI)

**Files:**
- Create: `voice-agent-conoha-l4/frontend/app/talk/page.tsx`
- Create: `voice-agent-conoha-l4/frontend/components/OrderReceipt.tsx`
- Create: `voice-agent-conoha-l4/frontend/components/OrderTicker.tsx`

- [ ] **Step 1: Write `components/OrderReceipt.tsx`**

```tsx
// voice-agent-conoha-l4/frontend/components/OrderReceipt.tsx
"use client";

import type { OrderItem } from "@/lib/types";

interface Props {
  items: OrderItem[];
  status: "idle" | "pending" | "persisted" | "closed" | "error";
  orderId: string | null;
}

export function OrderReceipt({ items, status, orderId }: Props) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4">
      <header className="flex justify-between text-sm opacity-70">
        <span>受注票</span>
        <span>{orderId ?? "(未発行)"}</span>
      </header>
      <ul className="mt-2 space-y-1">
        {items.length === 0 && <li className="opacity-50 italic">まだ注文がありません</li>}
        {items.map((it, i) => (
          <li key={i} className="flex justify-between">
            <span>{it.name}</span><span>×{it.qty}</span>
          </li>
        ))}
      </ul>
      <footer className="mt-3 text-xs opacity-70">状態: {status}</footer>
    </div>
  );
}
```

- [ ] **Step 2: Write `components/OrderTicker.tsx`**

```tsx
// voice-agent-conoha-l4/frontend/components/OrderTicker.tsx
"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/types";

interface Event {
  type: "order_added" | "order_updated" | "order_closed";
  order?: Order;
  order_id?: string;
}

export function OrderTicker() {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    const url = `${location.origin.replace(/^http/, "ws")}/api/events`;
    const ws = new WebSocket(url);
    ws.onmessage = (e) => {
      setEvents((prev) => [JSON.parse(e.data) as Event, ...prev].slice(0, 20));
    };
    return () => ws.close();
  }, []);

  return (
    <aside className="bg-zinc-900 rounded-xl p-4 w-full">
      <h3 className="text-sm font-semibold mb-2">リアルタイム業務イベント</h3>
      <ul className="space-y-1 text-xs">
        {events.map((e, i) => (
          <li key={i} className="opacity-80">
            [{e.type}] {e.order?.order_id ?? e.order_id} {e.order ? `(${e.order.items.length} item)` : ""}
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 3: Write `app/talk/page.tsx`**

```tsx
// voice-agent-conoha-l4/frontend/app/talk/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OrderReceipt } from "@/components/OrderReceipt";
import { OrderTicker } from "@/components/OrderTicker";
import { startVoice, closeVoice, type AgentEvent, type VoiceSession } from "@/lib/voice";
import type { Mode, OrderItem } from "@/lib/types";

const MODE_LABEL: Record<Mode, string> = {
  emergency: "🚑 救急センター",
  military:  "🪖 作戦司令部",
  callcenter:"☎️ コールセンター",
};

export default function TalkPage() {
  const params = useSearchParams();
  const mode = (params.get("mode") ?? "callcenter") as Mode;

  const sessionRef = useRef<VoiceSession | null>(null);
  const [status, setStatus] = useState<"idle"|"connecting"|"listening"|"speaking"|"error">("idle");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");

  function handleEvent(e: AgentEvent) {
    switch (e.type) {
      case "user_transcript":
        setTranscript(e.text);
        setStatus("speaking");
        break;
      case "tool_call":
        if (e.name === "add_order") setItems((e.args.items as OrderItem[]) ?? []);
        break;
      case "order_persisted":
        setOrderId(e.order_id);
        setStatus("listening");
        break;
      case "assistant_text":
        // optional subtitle UI
        break;
      case "empty_transcript":
        setStatus("listening");
        break;
      case "error":
        setStatus("error");
        break;
    }
  }

  async function connect() {
    setStatus("connecting");
    try {
      sessionRef.current = await startVoice(mode, handleEvent);
      setStatus("listening");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => () => {
    if (sessionRef.current) closeVoice(sessionRef.current);
  }, []);

  return (
    <main className="min-h-screen p-6 flex flex-col gap-4 max-w-2xl mx-auto">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl">{MODE_LABEL[mode]}</h1>
        <span className="text-xs px-2 py-1 bg-zinc-800 rounded">{status}</span>
      </header>

      {status === "idle" && (
        <button onClick={connect} className="bg-emerald-600 rounded-xl py-3">
          通話を開始
        </button>
      )}

      {status !== "idle" && (
        <div className="bg-zinc-900 rounded-xl p-4 min-h-[3rem]">
          <p className="text-sm opacity-70">あなたの発話</p>
          <p className="text-lg">{transcript || "..."}</p>
        </div>
      )}

      <OrderReceipt items={items} status={status === "speaking" ? "pending" : "persisted"} orderId={orderId} />
      <OrderTicker />
    </main>
  );
}
```

- [ ] **Step 4: Sanity build**

```bash
cd voice-agent-conoha-l4/frontend && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add voice-agent-conoha-l4/frontend/app/talk/page.tsx voice-agent-conoha-l4/frontend/components/
git commit -m "feat(frontend): add talk page with VAD-based UI and OrderTicker"
```

## Task 32: Frontend Dockerfile + rewrites

**Files:**
- Modify: `voice-agent-conoha-l4/frontend/next.config.mjs`
- Create: `voice-agent-conoha-l4/frontend/Dockerfile`

- [ ] **Step 1: Update `next.config.mjs` with rewrites**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/offer", destination: "http://agent:8080/offer" },
      { source: "/api/orders/:path*", destination: "http://backend:8000/api/orders/:path*" },
      { source: "/api/events", destination: "http://backend:8000/api/events" },
    ];
  },
};
export default nextConfig;
```

- [ ] **Step 2: Write `Dockerfile` (multistage standalone)**

```dockerfile
# voice-agent-conoha-l4/frontend/Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Commit**

```bash
git add voice-agent-conoha-l4/frontend/next.config.mjs voice-agent-conoha-l4/frontend/Dockerfile
git commit -m "feat(frontend): add Dockerfile + agent/backend rewrites"
```

---

# Phase F — Compose + ConoHa deploy + Docs

## Task 33: docker compose

**Files:**
- Create: `voice-agent-conoha-l4/compose.yml`
- Create: `voice-agent-conoha-l4/.env.example`

- [ ] **Step 1: Write `compose.yml`**

```yaml
# voice-agent-conoha-l4/compose.yml
services:
  frontend:
    build: ./frontend
    expose: ["3000"]
    environment:
      - PUBLIC_BASE_URL
    depends_on:
      agent:
        condition: service_healthy
      backend:
        condition: service_healthy

  agent:
    build: ./agent
    expose: ["8080"]
    environment:
      - ALLOWED_ORIGINS
      - OFFER_RATE_LIMIT_PER_MIN
      - MAX_CONCURRENT_SESSIONS
      - SESSION_MAX_DURATION_SEC
      - LLM_URL
      - LLM_MODEL
      - WHISPER_MODEL_SIZE
      - SBV2_MODEL_DIR
      - BACKEND_URL
      - RESTAURANT_NAME
      - HF_TOKEN
    volumes:
      - models:/models
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "python3.12", "-c", "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz').status==200 else 1)"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 180s
    depends_on:
      backend:
        condition: service_healthy
      llm:
        condition: service_healthy

  llm:
    build: ./llm
    expose: ["8000"]
    environment:
      - LLM_MODEL
      - GPU_MEMORY_UTILIZATION
      - MAX_MODEL_LEN
      - HF_TOKEN
    volumes:
      - models:/root/.cache/huggingface
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8000/v1/models || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 60
      start_period: 240s

  backend:
    build: ./backend
    expose: ["8000"]
    environment:
      - ALLOWED_ORIGINS
      - ORDERS_RATE_LIMIT_PER_MIN
      - GOOGLE_APPLICATION_CREDENTIALS_JSON
      - SHEET_ID
      - RESTAURANT_NAME
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

volumes:
  models:
```

- [ ] **Step 2: Write `.env.example`**

```bash
# voice-agent-conoha-l4/.env.example

# === Public-facing URL ===
PUBLIC_BASE_URL=https://voice-agent.example.com
ALLOWED_ORIGINS=https://voice-agent.example.com

# === Agent ===
OFFER_RATE_LIMIT_PER_MIN=3
MAX_CONCURRENT_SESSIONS=5
SESSION_MAX_DURATION_SEC=600
WHISPER_MODEL_SIZE=medium
SBV2_MODEL_DIR=/models/sbv2
BACKEND_URL=http://backend:8000
LLM_URL=http://llm:8000/v1

# === LLM ===
LLM_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ
GPU_MEMORY_UTILIZATION=0.40
MAX_MODEL_LEN=4096
HF_TOKEN=                  # required only for gated models

# === Backend ===
ORDERS_RATE_LIMIT_PER_MIN=30
RESTAURANT_NAME=カフェ・コノハ
SHEET_ID=                  # spreadsheet ID from the URL
# Single-line JSON. See README §"Google Sheets セットアップ".
GOOGLE_APPLICATION_CREDENTIALS_JSON=
```

- [ ] **Step 3: Commit**

```bash
git add voice-agent-conoha-l4/compose.yml voice-agent-conoha-l4/.env.example
git commit -m "feat(infra): add docker compose and .env.example"
```

## Task 34: conoha.yml

**Files:**
- Create: `voice-agent-conoha-l4/conoha.yml`

- [ ] **Step 1: Write `conoha.yml`**

```yaml
# voice-agent-conoha-l4/conoha.yml
name: voice-agent-conoha-l4

# Replace with your own FQDN before running `conoha app init`.
hosts:
  - voice-agent.example.com

# Required GPU flavor — the agent and llm services need an L4.
flavor: g2l-t-c4m16g1-l4

web:
  service: frontend
  port: 3000

# These stay alive across blue/green swaps (only frontend is duplicated).
accessories:
  - backend
  - llm
  - agent
```

- [ ] **Step 2: Commit**

```bash
git add voice-agent-conoha-l4/conoha.yml
git commit -m "feat(infra): add conoha.yml (L4 flavor)"
```

## Task 35: Pre-fetch SBV2 voice weights script

**Files:**
- Create: `voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh`

- [ ] **Step 1: Write script**

```bash
#!/usr/bin/env bash
# voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh
#
# One-shot helper: download a default SBV2 Japanese voice into the `models`
# named volume so the agent container can use it on first boot.
# Run on the ConoHa host after `conoha app init` but before `conoha app deploy`.
set -euo pipefail

VOLUME=$(docker volume ls -qf name=voice-agent-conoha-l4_models | head -1)
if [ -z "$VOLUME" ]; then
  echo "Models volume not found. Run 'docker compose up backend' once to create it." >&2
  exit 1
fi

TARGET="/var/lib/docker/volumes/${VOLUME}/_data/sbv2"
mkdir -p "$TARGET"

# litagin/style_bert_vits2_jvnv has a permissively-licensed voice.
git clone --depth=1 https://huggingface.co/litagin/style_bert_vits2_jvnv "$TARGET"

echo "SBV2 weights placed at $TARGET"
```

```bash
chmod +x voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh
```

- [ ] **Step 2: Commit**

```bash
git add voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh
git commit -m "chore(infra): add SBV2 weight fetcher script"
```

## Task 36: README (Japanese)

**Files:**
- Create: `voice-agent-conoha-l4/README.md`

- [ ] **Step 1: Write `README.md`** — the canonical doc, full setup walkthrough:

```markdown
# voice-agent-conoha-l4

ConoHa VPS3 L4 GPU 上に **自己ホストの音声エージェント** を構築するサンプル。
ブラウザで QR を撮るだけで AI と音声会話ができ、会話の内容が Google Sheets
にリアルタイムで業務データとして書き込まれる。OpenAI など外部 AI サービス
への通信は**一切なし**。

`voice-agent-webrtc-realtime` (OpenAI Realtime API 依存) の後継。同じ
ユースケース・3 モードの「○○食堂の注文受付 AI」を自己ホスト構成で実現する。

## 構成

| レイヤー | 技術 |
|---|---|
| フロント | Next.js 16 (App Router, standalone) |
| 音声 AI agent | Pipecat + aiortc + Silero VAD |
| STT | faster-whisper (medium, ja/en/ko 自動) |
| LLM | vLLM + Qwen/Qwen2.5-7B-Instruct-AWQ (function calling) |
| TTS | Style-BERT-VITS2 (jvnv 系) |
| バックエンド | FastAPI — 注文 API + Google Sheets + WS broadcast |
| GPU | NVIDIA L4 24GB (`g2l-t-c4m16g1-l4`) |

設計詳細: [`docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md`](../docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md)

## 前提条件

- [conoha-cli](https://github.com/crowdy/conoha-cli) `>= v0.8.0`
- ConoHa VPS3 アカウント、SSH キーペア
- 自分の制御下の DNS で FQDN を 1 つ用意できる
- Google サービスアカウントと共有済みスプレッドシート

## 環境変数

`.env.example` をコピーして `.env` を作成し値を埋める。詳細は `.env.example`
のコメントを参照。最低限必要:

| 変数 | 説明 |
|---|---|
| `PUBLIC_BASE_URL` | デプロイ先 FQDN (HTTPS) |
| `ALLOWED_ORIGINS` | `PUBLIC_BASE_URL` と同じ |
| `SHEET_ID` | スプレッドシート ID |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | サービスアカウント JSON を 1 行で |

## デプロイ手順

```bash
# 1. GPU VPS を作成
conoha server create --name voice-agent-l4 --flavor g2l-t-c4m16g1-l4 \
    --image ubuntu-24.04 --key <ssh-key>

# 2. 出力された IP に DNS A レコードを設定し、伝播を待つ
dig +short voice-agent.example.com    # IP と一致まで待機

# 3. conoha-proxy 起動 (ACME)
conoha proxy boot --acme-email you@example.com voice-agent-l4

# 4. conoha.yml の `hosts:` を自分の FQDN に書き換える

# 5. SBV2 weights を事前配置 (初回のみ)
ssh root@<vps> 'bash -s' < voice-agent-conoha-l4/scripts/fetch-sbv2-weights.sh

# 6. デプロイ (初回は GPU image pull + モデルダウンロードで 10-15 分)
cd voice-agent-conoha-l4
conoha app init voice-agent-l4
conoha app deploy voice-agent-l4

# 7. /healthz が 200 を返したら起動完了 (モデル warmup 90-120s)
curl https://voice-agent.example.com/healthz
```

## スモークテスト

```bash
# 注文 POST
ORDER=$(curl -fsS -X POST https://voice-agent.example.com/api/orders \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"mode":"callcenter","language":"ja","items":[{"name":"スモークラーメン","qty":1}]}')
OID=$(echo "$ORDER" | jq -r .order_id)

# 更新
curl -fsS -X PATCH https://voice-agent.example.com/api/orders/$OID \
  -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
  -d '{"items":[{"name":"スモークラーメン","qty":2}],"notes":"smoke"}' | jq .

# Origin 拒否確認
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://voice-agent.example.com/api/offer \
  -H "Origin: https://evil.example.com" \
  -H "Content-Type: application/json" \
  -d '{"sdp":"x","type":"offer","mode":"callcenter"}'
# 期待: 403
```

QR スキャン → `/talk?mode=...` で「親子丼を1つ」のような短い発話 → 約 2 秒で
AI が応答 → Sheets に行追加・別ブラウザの OrderTicker に反映。

## ⚠️ セキュリティ上の注意

- `ALLOWED_ORIGINS` を自分の FQDN に設定する。空のままだと任意のサイトから
  `/offer` を呼び出されて GPU 資源が消費される。
- `OFFER_RATE_LIMIT_PER_MIN` 既定 3、`MAX_CONCURRENT_SESSIONS` 既定 5。
  公開デモは慎重に。
- 認証はかかっていない。本格的な顧客向け展開には別途認証フローが必要。
- 音声通話の内容は Sheets に書き込まれる。**個人情報は入力しないこと**。

## 検討の経緯

OpenAI Realtime API ベースのサンプル (`voice-agent-webrtc-realtime`) を出発
点にしつつ、GMO 内部での OpenAI 利用制限を受けて、外部 AI 依存を排除する
構成として本サンプルが作られた。代替案として LiveKit Agents や end-to-end
Moshi を検討したが、Pipecat ベースの STT+LLM+TTS パイプラインが既存サンプル
(`vllm-gpu`, `fish-speech-tts-gpu`) とパターンを揃えやすく採用した。
```

- [ ] **Step 2: Commit**

```bash
git add voice-agent-conoha-l4/README.md
git commit -m "docs(voice-agent-conoha-l4): add README"
```

## Task 37: examples/sample-sheet.md and demo-script.md

**Files:**
- Create: `voice-agent-conoha-l4/examples/sample-sheet.md`
- Create: `voice-agent-conoha-l4/examples/demo-script.md`

- [ ] **Step 1: Write `sample-sheet.md`**

```markdown
# Google Sheets セットアップ

1. 空のスプレッドシートを作成。タブ名を `orders` にする。
2. 1 行目に次のヘッダーを入れる:
   `order_id | created_at | updated_at | mode | language | items | customer_label | notes | status`
3. GCP プロジェクトでサービスアカウントを作成、JSON キーをダウンロード。
4. スプレッドシートの「共有」でサービスアカウントのメールアドレスを **編集者**
   として追加。
5. URL の `https://docs.google.com/spreadsheets/d/<ID>/edit` から `<ID>` を取得。
6. `.env` に `SHEET_ID=<ID>`、`GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":...}'`
   (改行を消した 1 行) を設定。
```

- [ ] **Step 2: Write `demo-script.md`**

```markdown
# デモ進行シナリオ

## 1. ☎️ コールセンター
- 「いらっしゃいませ、○○食堂です」というオープニング後
- 「親子丼を1つ、それから味噌汁もお願いします」
- AI が確認 → Sheets に行 1 件追加
- 「あ、親子丼を2つに増やしてください」→ update_order が走り Sheets が書き換わる
- 「以上で」→ close_order で締め

## 2. 🚑 救急センター
- 「親子丼が必要、患者は45歳男性」(冗談)
- AI が無線通信風に復唱

## 3. 🪖 作戦司令部
- 「コールサインこちらアルファ、補給品目: 親子丼 ×3」
- AI が無線交信風に応答 → Sheets 記録

別ブラウザで `/` を開いておくと OrderTicker に各イベントが時系列で流れる。
```

- [ ] **Step 3: Commit**

```bash
git add voice-agent-conoha-l4/examples/
git commit -m "docs(voice-agent-conoha-l4): add Sheets setup + demo script"
```

## Task 38: README-ko.md, README-en.md

**Files:**
- Create: `voice-agent-conoha-l4/README-ko.md`
- Create: `voice-agent-conoha-l4/README-en.md`

- [ ] **Step 1: Translate `README.md` to Korean and English (one-shot translation, keep same structure)**

For the agent doing this: take `voice-agent-conoha-l4/README.md` and produce direct translations preserving headings, code blocks, and command listings verbatim. Body text translated to ko / en respectively.

- [ ] **Step 2: Commit**

```bash
git add voice-agent-conoha-l4/README-ko.md voice-agent-conoha-l4/README-en.md
git commit -m "docs(voice-agent-conoha-l4): add Korean and English READMEs"
```

## Task 39: Repository top-level cross-references

**Files:**
- Modify: `README.md` (top-level) — add link to new sample
- Modify: any sample index files if present

- [ ] **Step 1: Inspect top-level README**

```bash
head -200 README.md
```

If a sample table exists, add a row for `voice-agent-conoha-l4`. If not, skip
this task.

- [ ] **Step 2: Commit if changed**

```bash
git add README.md
git commit -m "docs: link voice-agent-conoha-l4 sample"
```

---

# Phase G — Deploy + PR + close #105

## Task 40: Push branch and open PR

**Files:** none

- [ ] **Step 1: Run full non-GPU test suite**

```bash
cd voice-agent-conoha-l4/backend && pytest -m "not gpu" -v
cd ../agent && pytest -m "not gpu" -v
cd ../frontend && npx next build
```

All green required.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/voice-agent-conoha-l4
```

- [ ] **Step 3: Open PR via gh**

```bash
gh pr create --title "feat: voice-agent-conoha-l4 (self-hosted GPU voice agent, supersedes #105)" \
  --body "$(cat <<'EOF'
## Summary
- Self-hosted alternative to PR #105 (voice-agent-webrtc-realtime).
- Pipecat + faster-whisper + vLLM (Qwen2.5-7B AWQ) + Style-BERT-VITS2 on ConoHa VPS3 L4 24GB.
- Preserves 3-mode UX (🚑 emergency / 🪖 military / ☎️ callcenter), function calling, Google Sheets fan-out.
- No OpenAI dependency.

Supersedes #105. Reasoning: OpenAI internal-use restriction.

Spec: `docs/superpowers/specs/2026-05-15-voice-agent-conoha-l4-design.md`
Plan: `docs/superpowers/plans/2026-05-15-voice-agent-conoha-l4.md`

## Test plan
- [x] Non-GPU unit tests pass for backend and agent
- [x] Frontend `next build` clean
- [ ] GPU integration tests pass on the actual L4 host (see plan Phase D)
- [ ] ConoHa deploy succeeds and `/healthz` flips to 200 after warmup
- [ ] Smoke script in README produces a Sheets row and an OrderTicker event
- [ ] `/api/offer` rejects unknown Origin with 403
- [ ] `/api/offer` enforces `OFFER_RATE_LIMIT_PER_MIN`
- [ ] Concurrent session cap returns 503 on the 6th client
- [ ] `tcpdump` shows zero outbound traffic to `api.openai.com`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Comment on PR #105 and close it**

```bash
gh pr comment 105 --body "Superseded by #$(gh pr view --json number -q .number). The self-hosted L4 GPU implementation replaces the OpenAI Realtime version. Closing without merging."
gh pr close 105
```

- [ ] **Step 5: Delete the old remote branch (optional, after user approval)**

```bash
# Run only with explicit user approval — preserves git history but removes the branch ref.
git push origin --delete feat/voice-agent-webrtc-realtime
```

## Task 41: Deploy to ConoHa and run smoke tests

**Files:** none

This task is **human-supervised** because it touches real cloud resources
and depends on user-supplied DNS, OpenAI-free credentials, and a Sheets
spreadsheet.

- [ ] **Step 1: Ask user for FQDN, SHEET_ID, service-account JSON, DNS readiness**

- [ ] **Step 2: Create VPS**

```bash
conoha server create --name voice-agent-l4 --flavor g2l-t-c4m16g1-l4 \
    --image ubuntu-24.04 --key <user-key>
```

Record the IP.

- [ ] **Step 3: Wait for DNS A-record propagation (user does this externally; poll with ScheduleWakeup, 1200s)**

```bash
until [ "$(dig +short voice-agent.example.com)" = "<vps-ip>" ]; do sleep 30; done
```

- [ ] **Step 4: Start conoha-proxy**

```bash
conoha proxy boot --acme-email <user-email> voice-agent-l4
```

- [ ] **Step 5: Edit `conoha.yml` `hosts:` to user FQDN, commit, push**

- [ ] **Step 6: Init + Deploy**

```bash
cd voice-agent-conoha-l4
conoha app init voice-agent-l4
ssh root@<vps> 'bash -s' < scripts/fetch-sbv2-weights.sh   # before first deploy
conoha app deploy voice-agent-l4
```

Wait via `ScheduleWakeup` (1200s+) for first deploy. Subsequent deploys are
shorter.

- [ ] **Step 7: Verify healthz**

```bash
curl -fsS https://voice-agent.example.com/healthz
```

If 503 for more than 4 minutes after deploy completes, exec into agent
container and check warmup logs:

```bash
ssh root@<vps> docker logs voice-agent-conoha-l4-agent-1 --tail=200
```

- [ ] **Step 8: Run smoke commands from README**

- [ ] **Step 9: Run the additional checks not in README:**

```bash
# 6 successful, 7th 429
for i in $(seq 1 7); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://voice-agent.example.com/api/offer \
    -H "Content-Type: application/json" -H "Origin: https://voice-agent.example.com" \
    -d '{"sdp":"v=0\r\n","type":"offer","mode":"callcenter"}'
done; echo

# No OpenAI traffic at all
ssh root@<vps> 'tcpdump -i any -nn -c 100 host api.openai.com or host openai.com' &
# (run a short voice session in browser)
# expect tcpdump to print nothing matching the filter
```

- [ ] **Step 10: Report results to user**

Use the existing report format:
```
✅ <step>: <terse>
❌ <step>: <error + next action>
⏭️  <step>: <skip reason>
```

- [ ] **Step 11: Tear-down prompt**

Ask user if they want to keep the VPS or delete it; on approval:

```bash
conoha app delete voice-agent-conoha-l4 voice-agent-l4
conoha server delete voice-agent-l4
```

---

# Self-review notes

This plan covers every requirement in the spec:

- **Architecture (4 containers)** — Tasks 11, 25, 26, 32–33
- **Pipecat pipeline (STT→LLM→TTS+VAD)** — Tasks 18, 21, 22, 24
- **3 modes** — Task 14
- **4 tools + dispatcher to backend** — Tasks 9, 15
- **Sheets fan-out** — Tasks 7, 9
- **WS event broker** — Task 8
- **Sheets credential sanitization** — Task 7
- **Origin allowlist** — Tasks 4, 16
- **Per-IP rate limits (orders + offer)** — Tasks 4, 16
- **Concurrent session cap** — Tasks 16, 19, 24
- **Warmup gate on `/healthz`** — Task 23
- **Frontend QR + talk + voice client** — Tasks 27–32
- **docker compose with GPU reservation** — Task 33
- **`conoha.yml` with L4 flavor** — Task 34
- **README ja/ko/en** — Tasks 36, 38
- **Deploy + smoke tests + close PR #105** — Tasks 40, 41

No "TBD" / "TODO" / "appropriate error handling" placeholders. Every step
that touches code carries the actual code in a fenced block. Type names
and method signatures match across tasks (e.g., `ConversationLoop.turn`,
`ToolExecutor.dispatch`, `WebRTCNegotiator.handle_offer`, `VoiceSession`).
