"""Resolve CLI configuration from flags, env vars, and ~/.slurm-api/ files.

Priority (highest first):
1. CLI flags (--endpoint, --token, --user)
2. Environment variables (SLURM_API_ENDPOINT, SLURM_API_TOKEN, SLURM_API_USER)
3. Files in config_dir (endpoint, token; user defaults to 'slurm')
"""
from __future__ import annotations

import os
import pathlib
from dataclasses import dataclass
from typing import Optional


DEFAULT_USER = "slurm"


@dataclass(frozen=True)
class Config:
    endpoint: str
    token: str
    user: str


def _read_file(path: pathlib.Path) -> Optional[str]:
    if not path.exists():
        return None
    text = path.read_text().strip()
    return text or None


def resolve_config(
    cli_endpoint: Optional[str],
    cli_token: Optional[str],
    cli_user: Optional[str],
    config_dir: Optional[pathlib.Path] = None,
) -> Config:
    if config_dir is None:
        config_dir = pathlib.Path.home() / ".slurm-api"

    endpoint = (
        cli_endpoint
        or os.environ.get("SLURM_API_ENDPOINT")
        or _read_file(config_dir / "endpoint")
    )
    token = (
        cli_token
        or os.environ.get("SLURM_API_TOKEN")
        or _read_file(config_dir / "token")
    )
    user = (
        cli_user
        or os.environ.get("SLURM_API_USER")
        or DEFAULT_USER
    )

    if not endpoint:
        raise RuntimeError(
            "Slurm API endpoint not configured. "
            "Set --endpoint, SLURM_API_ENDPOINT, or write "
            f"{config_dir / 'endpoint'}"
        )
    if not token:
        raise RuntimeError(
            "Slurm API token not configured. "
            "Set --token, SLURM_API_TOKEN, or write "
            f"{config_dir / 'token'}"
        )

    return Config(endpoint=endpoint.rstrip("/"), token=token, user=user)
