"""Runtime configuration sourced from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    job_dir: Path
    max_concurrent: int
    max_elements: int
    solver_timeout_seconds: int
    job_ttl_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            job_dir=Path(os.environ.get("OCFEM_JOB_DIR", "/tmp/jobs")),
            max_concurrent=int(os.environ.get("OCFEM_MAX_CONCURRENT", "2")),
            max_elements=int(os.environ.get("OCFEM_MAX_ELEMENTS", "200000")),
            solver_timeout_seconds=int(os.environ.get("OCFEM_SOLVER_TIMEOUT_SECONDS", "60")),
            job_ttl_seconds=int(os.environ.get("OCFEM_JOB_TTL_SECONDS", "1800")),
        )
