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
