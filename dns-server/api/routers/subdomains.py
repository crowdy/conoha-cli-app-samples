"""Subdomain CRUD.

Each "subdomain" maps to all rows in PowerDNS `records` sharing the same
`name`. Writes go through a single transaction that bumps the SOA serial.
"""

from __future__ import annotations

import json
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
    return json.dumps([r.model_dump() for r in records])
