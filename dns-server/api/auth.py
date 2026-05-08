"""Bearer token authentication.

The store interface is abstract so tests can swap a fake implementation
without touching the database. The production store reads from
app.api_tokens via asyncpg.
"""

from __future__ import annotations

from typing import Any, Protocol

import bcrypt
from fastapi import Header, HTTPException, status

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
        try:
            if bcrypt.checkpw(raw.encode(), row["token_hash"].encode()):
                return row["id"]
        except (ValueError, TypeError):
            # Malformed/corrupt token_hash row — skip rather than 500.
            continue
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
