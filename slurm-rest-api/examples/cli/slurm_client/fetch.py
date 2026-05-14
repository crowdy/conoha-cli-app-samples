"""Retrieve a job's result file from the gpu-worker container.

slurmrestd does not serve job output files, so `slurm_cli.py fetch` uses
an SSH side channel: it resolves the server's IPv4 with `conoha server
ips`, then `ssh ... docker exec <gpu-worker> cat <remote_path>` and writes
the bytes to a local file. The gpu-worker container is located by its
compose service label (project-name-agnostic — same trick as
get-token.sh, see postmortem C4).
"""
from __future__ import annotations

import shlex
import subprocess
from typing import Optional


def build_fetch_command(
    *,
    ip: str,
    identity: Optional[str],
    remote_path: str,
    ssh_user: str = "root",
) -> list[str]:
    """Build the ssh argv that cats a result file from the gpu-worker.

    Returned argv runs `cat <remote_path>` inside whichever container
    carries the `com.docker.compose.service=gpu-worker` label. stdout is
    the raw file bytes — the caller redirects it to a local file.
    """
    remote_cmd = (
        "docker exec "
        "$(docker ps -qf label=com.docker.compose.service=gpu-worker | head -1) "
        f"cat {shlex.quote(remote_path)}"
    )
    cmd = ["ssh"]
    if identity:
        cmd += ["-i", identity]
    cmd += [
        "-o", "StrictHostKeyChecking=accept-new",
        f"{ssh_user}@{ip}",
        remote_cmd,
    ]
    return cmd


def resolve_server_ip(server: str) -> str:
    """Resolve a conoha server name to its IPv4 via `conoha server ips`."""
    out = subprocess.run(
        ["conoha", "server", "ips", server],
        capture_output=True, text=True, check=True,
        timeout=30,
    ).stdout
    # lines look like:  ext-gpu-...: 203.0.113.5 (v4, fixed)
    for line in out.splitlines():
        if "(v4" in line and ":" in line:
            return line.split(":", 1)[1].strip().split()[0]
    raise RuntimeError(f"no IPv4 found for server {server!r} in:\n{out}")
