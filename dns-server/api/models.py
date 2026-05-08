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
