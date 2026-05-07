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
from api.models import Record, SubdomainCreate, SubdomainResponse, SubdomainUpdate
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
