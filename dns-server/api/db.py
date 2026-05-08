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
