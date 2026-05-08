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
