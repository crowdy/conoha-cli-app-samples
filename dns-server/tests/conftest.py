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
    deadline = asyncio.get_running_loop().time() + 60
    async with httpx.AsyncClient() as client:
        while asyncio.get_running_loop().time() < deadline:
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
