"""Build slurmrestd job-submit payloads.

Two modes:
- inline=True: embed Python source as a heredoc inside the wrapper bash script
- inline=False: wrapper bash script runs `python3 <script_path>` (the file
  must already exist inside the container at /work/scripts/<name>)
"""
from __future__ import annotations

from typing import Any, Optional


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
        "partition": "debug",
        "cpus_per_task": cpus,
        "memory_per_node": memory_mb,
        "time_limit": time_limit_min,
        "current_working_directory": "/work",
        "standard_output": "/work/logs/%j.out",
        "standard_error": "/work/logs/%j.err",
        "environment": ["PATH=/usr/bin:/bin"],
    }
    if array:
        job["array"] = array

    return {"job": job, "script": wrapper}
