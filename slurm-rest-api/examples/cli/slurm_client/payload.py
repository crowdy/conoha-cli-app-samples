"""Build slurmrestd job-submit payloads.

Two modes:
- inline=True: embed Python source as a heredoc inside the wrapper bash script
- inline=False: wrapper bash script runs `python3 <script_path>` (the file
  must already exist inside the container at /data/scripts/<name>)

The shared job directory is /data (the giovtorres image's slurm_jobdir).
"""
from __future__ import annotations

import re
from typing import Any, Optional

DEFAULT_PARTITION = "cpu"

# sbatch --gres grammar we accept: NAME:COUNT or NAME:TYPE:COUNT, e.g.
# "gpu:1", "gpu:nvidia:1". NAME/TYPE are alphanumeric+underscore; COUNT
# is a non-negative integer.
_GRES_RE = re.compile(r"^[A-Za-z][\w]*(:[A-Za-z][\w]*)?:\d+$")
# Job stdout/stderr is per-container ephemeral storage (`/tmp` inside the
# cpu-worker container). For shared workload outputs (e.g., the sweep
# collector) mount a named volume into both slurmctld and cpu-worker at
# the path your scripts write to.
JOB_DIR = "/tmp"


def _normalize_gres(gres: str) -> str:
    """Translate an sbatch-style `--gres` spec into the slurmrestd TRES form.

    Input is the familiar sbatch grammar — `gpu:1` or `gpu:nvidia:1` — and
    the result is the `gres/...` form the v0.0.42 schema expects in
    `tres_per_node`. We validate strictly: a malformed spec (missing colon,
    non-numeric count, an already-`gres/`-prefixed value) is rejected here
    with a clear message rather than being passed through to slurmrestd,
    which would otherwise reject it with the opaque error 2072 "Invalid
    generic resource (gres) specification".
    """
    g = gres.strip()
    if not _GRES_RE.match(g):
        raise ValueError(
            f"invalid --gres spec {gres!r}: expected sbatch-style "
            "'NAME:COUNT' or 'NAME:TYPE:COUNT', e.g. 'gpu:1' or 'gpu:nvidia:1'"
        )
    return f"gres/{g}"


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
        # tres_per_node is the v0.0.42 field that sbatch's --gres=gpu:N
        # maps to (per-node allocation, matching the gpu-worker's
        # Gres=gpu:nvidia:N registration). tres_per_task / tres_per_job
        # exist too but use different scoping rules; tres_per_node is the
        # canonical translation of --gres.
        job["tres_per_node"] = _normalize_gres(gres)

    return {"job": job, "script": wrapper}
