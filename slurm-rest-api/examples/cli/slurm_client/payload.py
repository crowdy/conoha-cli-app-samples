"""Build slurmrestd job-submit payloads.

Two modes:
- inline=True: embed Python source as a heredoc inside the wrapper bash script
- inline=False: wrapper bash script runs `python3 <script_path>` (the file
  must already exist inside the container at /data/scripts/<name>)

The shared job directory is /data (the giovtorres image's slurm_jobdir).
"""
from __future__ import annotations

from typing import Any, Optional

DEFAULT_PARTITION = "cpu"
# Job stdout/stderr is per-container ephemeral storage (`/tmp` inside the
# cpu-worker container). For shared workload outputs (e.g., the sweep
# collector) mount a named volume into both slurmctld and cpu-worker at
# the path your scripts write to.
JOB_DIR = "/tmp"


def _normalize_gres(gres: str) -> str:
    """Translate user-facing `gpu:N` / `gres/gpu:N` into the TRES form.

    sbatch's familiar `--gres=gpu:1` becomes `gres/gpu:1` on the REST API.
    Accepting both lets users paste sbatch flags verbatim without thinking
    about the schema difference.
    """
    g = gres.strip()
    return g if g.startswith("gres/") else f"gres/{g}"


def build_submit_payload(
    *,
    name: str,
    script_body: Optional[str],
    cpus: int,
    memory_mb: int,
    time_limit_min: int,
    array: Optional[str],
    inline: bool,
    script_path: Optional[str] = None,
    partition: str = DEFAULT_PARTITION,
    gres: Optional[str] = None,
) -> dict[str, Any]:
    if inline:
        if not script_body:
            raise ValueError("inline mode requires script_body")
        wrapper = (
            "#!/bin/bash\n"
            "python3 - <<'__SLURM_CLI_PY_EOF__'\n"
            f"{script_body}"
            "__SLURM_CLI_PY_EOF__\n"
        )
    else:
        if not script_path:
            raise ValueError("non-inline mode requires script_path")
        wrapper = f"#!/bin/bash\npython3 {script_path}\n"

    job: dict[str, Any] = {
        "name": name,
        "partition": partition,
        "cpus_per_task": cpus,
        "memory_per_node": memory_mb,
        "time_limit": time_limit_min,
        "current_working_directory": JOB_DIR,
        "standard_output": f"{JOB_DIR}/slurm-%j.out",
        "standard_error": f"{JOB_DIR}/slurm-%j.err",
        "environment": ["PATH=/usr/bin:/bin"],
    }
    if array:
        job["array"] = array
    if gres:
        # tres_per_task is the v0.0.42 field that mirrors sbatch's
        # --gres=gpu:N semantics for single-task GPU jobs. The gpu-worker
        # registers `Gres=gpu:nvidia:N` so `gres/gpu:N` matches.
        job["tres_per_task"] = _normalize_gres(gres)

    return {"job": job, "script": wrapper}
