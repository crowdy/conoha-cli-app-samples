"""Pydantic models for the public API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, NonNegativeFloat, PositiveFloat

ShapeKind = Literal["bracket", "plate_hole", "cantilever_ibeam"]


class Material(BaseModel):
    E_GPa: PositiveFloat = Field(200.0, description="Young's modulus")
    nu: float = Field(0.3, ge=0.0, lt=0.5)


class Traction(BaseModel):
    magnitude_MPa: NonNegativeFloat = Field(10.0)


class JobSpec(BaseModel):
    shape: ShapeKind
    params: dict  # validated downstream against per-shape schema
    material: Material = Material()
    traction: Traction = Traction()
    mesh_size: PositiveFloat = Field(5.0, le=100.0)


class JobCreated(BaseModel):
    job_id: str


class StageEvent(BaseModel):
    stage: str
    t_ms: int
    message: str
    payload: dict | None = None
