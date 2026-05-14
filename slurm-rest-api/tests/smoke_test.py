"""Manual smoke test against a deployed slurm-rest-api stack.

Usage:
    SLURM_API_ENDPOINT=https://slurm.example.com \
    SLURM_API_TOKEN=$(cat ~/.slurm-api/token) \
    python3 tests/smoke_test.py

Default checks (each prints PASS/FAIL):
    1. /openapi/v3 returns 200
    2. GET /slurm/v0.0.42/nodes returns >= 1 node and one is IDLE
    3. POST /job/submit accepts a trivial 'echo hello smoke' job
    4. Job transitions to COMPLETED within 60s
    5. /slurmdb/v0.0.42/jobs includes the smoke job

Set `SLURM_SMOKE_GPU=1` to also exercise the gpu partition. Three extra
checks run after the CPU set (they need the gpu-worker accessory plus a
host with NVIDIA Container Toolkit + a CUDA device, i.e. ConoHa L4):
    6. /nodes contains a node tagged Gres=gpu:nvidia:N (N>=1)
    7. Submit to partition=gpu with tres_per_node=gres/gpu:1 returns job_id
    8. The GPU job transitions to COMPLETED (verifies torch sees the L4)

This module is import-safe: all network activity lives in main(), so the
pure helpers (e.g. gpu_gres_count) can be unit-tested without a cluster.
"""
import os
import re
import sys
import time

import requests

API = "v0.0.42"

# A node's gres string looks like "gpu:nvidia:1" — optionally a
# comma-separated list when multiple resource types are registered, e.g.
# "gpu:nvidia:1,mps:nvidia:0". Capture the count of the gpu entry only.
_GPU_GRES_RE = re.compile(r"gpu(?::[A-Za-z0-9_]+)?:(\d+)")


def gpu_gres_count(node: dict) -> int:
    """Return the total gpu count a node registered, 0 if none.

    Reads the slurmrestd node record's flat `gres` string. Robust to an
    empty/missing field, a bare `gpu:N` (no type), and multi-resource
    strings where a non-gpu entry happens to end in `:0`.
    """
    gres = node.get("gres") or ""
    return sum(int(n) for n in _GPU_GRES_RE.findall(gres))


def main() -> int:
    endpoint = os.environ["SLURM_API_ENDPOINT"].rstrip("/")
    token = os.environ["SLURM_API_TOKEN"]
    user = os.environ.get("SLURM_API_USER", "slurm")

    session = requests.Session()
    session.headers.update({
        "X-SLURM-USER-NAME": user,
        "X-SLURM-USER-TOKEN": token,
        "Accept": "application/json",
    })

    failures = 0

    def check(label, ok, detail=""):
        nonlocal failures
        if ok:
            print(f"PASS  {label}")
        else:
            print(f"FAIL  {label}  {detail}")
            failures += 1

    # 1. openapi
    r = session.get(f"{endpoint}/openapi/v3", timeout=15)
    check("openapi/v3 returns 200", r.status_code == 200, f"status={r.status_code}")

    # 2. nodes
    r = session.get(f"{endpoint}/slurm/{API}/nodes/", timeout=15)
    nodes = r.json().get("nodes", []) if r.ok else []
    idle = any("IDLE" in (n.get("state") or []) for n in nodes)
    check("nodes includes >=1 IDLE", r.ok and idle,
          f"status={r.status_code} count={len(nodes)} idle={idle}")

    # 3. submit
    payload = {
        "job": {
            "name": "smoke",
            "partition": "cpu",
            "cpus_per_task": 1,
            "memory_per_node": 64,
            "time_limit": 1,
            "current_working_directory": "/tmp",
            "standard_output": "/tmp/slurm-%j.out",
            "standard_error": "/tmp/slurm-%j.err",
            "environment": ["PATH=/usr/bin:/bin"],
        },
        "script": "#!/bin/bash\necho hello smoke\n",
    }
    r = session.post(f"{endpoint}/slurm/{API}/job/submit", json=payload, timeout=15)
    job_id = r.json().get("job_id") if r.ok else None
    check("submit returned job_id", bool(job_id),
          f"status={r.status_code} body={r.text[:200]}")

    # 4. wait for completion
    state = None
    if job_id:
        for _ in range(60):
            r = session.get(f"{endpoint}/slurm/{API}/job/{job_id}", timeout=15)
            jobs = r.json().get("jobs", [])
            if jobs:
                state = jobs[0].get("job_state", [])
                if "COMPLETED" in state or "FAILED" in state:
                    break
            time.sleep(1)
    check("job reached COMPLETED", bool(state) and "COMPLETED" in state,
          f"final state={state}")

    # Slurmdbd flushes job records on JobAcctGatherFrequency boundary plus
    # propagation. Wait briefly for the accounting record before checking.
    time.sleep(2)

    # 5. accounting
    seen = False
    acct_jobs = []
    for _ in range(30):
        r = session.get(f"{endpoint}/slurmdb/{API}/jobs/",
                        params={"users": user}, timeout=15)
        acct_jobs = r.json().get("jobs", []) if r.ok else []
        seen = any(j.get("name") == "smoke" for j in acct_jobs)
        if seen:
            break
        time.sleep(1)
    check("smoke job recorded in slurmdb", seen, f"count={len(acct_jobs)}")

    # -----------------------------------------------------------------------
    # Optional GPU checks (gated by SLURM_SMOKE_GPU=1). Skip silently on
    # CPU-only deploys so the default smoke set stays a clean 5/5.
    # -----------------------------------------------------------------------
    if os.environ.get("SLURM_SMOKE_GPU") == "1":
        # 6. gpu node visible with Gres >= 1.
        r = session.get(f"{endpoint}/slurm/{API}/nodes/", timeout=15)
        nodes = r.json().get("nodes", []) if r.ok else []
        gpu_idle = any(
            gpu_gres_count(n) >= 1 and ("IDLE" in (n.get("state") or []))
            for n in nodes
        )
        gpu_counts = {n.get("name"): gpu_gres_count(n) for n in nodes}
        check("nodes includes >=1 IDLE gpu node with Gres=gpu:nvidia:>=1",
              gpu_idle,
              f"no gpu-tagged IDLE node (per-node gpu counts: {gpu_counts}) "
              "— check gpu-worker is healthy and not INVALID_REG")

        # 7. submit a torch-cuda smoke job.
        gpu_payload = {
            "job": {
                "name": "smoke-gpu",
                "partition": "gpu",
                "cpus_per_task": 1,
                "memory_per_node": 512,
                "time_limit": 3,
                "tres_per_node": "gres/gpu:1",
                "current_working_directory": "/tmp",
                "standard_output": "/tmp/slurm-%j.out",
                "standard_error": "/tmp/slurm-%j.err",
                "environment": ["PATH=/usr/bin:/bin"],
            },
            # Inline python: the gpu image has torch, so we exercise it
            # end-to-end (driver -> toolkit -> cgroup -> torch.cuda).
            "script": (
                "#!/bin/bash\n"
                "python3 - <<'PY'\n"
                "import torch\n"
                "assert torch.cuda.is_available(), 'no cuda visible to torch'\n"
                "assert torch.cuda.device_count() >= 1\n"
                "x = torch.randn(256, 256, device='cuda') @ torch.randn(256, 256, device='cuda')\n"
                "torch.cuda.synchronize()\n"
                "print('cuda ok', torch.cuda.get_device_name(0), float(x.sum()))\n"
                "PY\n"
            ),
        }
        r = session.post(f"{endpoint}/slurm/{API}/job/submit",
                         json=gpu_payload, timeout=15)
        gpu_job_id = r.json().get("job_id") if r.ok else None
        check("gpu submit returned job_id", bool(gpu_job_id),
              f"status={r.status_code} body={r.text[:200]}")

        # 8. wait for completion.
        gpu_state = None
        if gpu_job_id:
            # GPU jobs need extra slack: container start + torch import is
            # ~10-15s cold-cache. Cap at 180s, generous on an L4.
            for _ in range(180):
                r = session.get(f"{endpoint}/slurm/{API}/job/{gpu_job_id}",
                                timeout=15)
                jobs = r.json().get("jobs", [])
                if jobs:
                    gpu_state = jobs[0].get("job_state", [])
                    if "COMPLETED" in gpu_state or "FAILED" in gpu_state:
                        break
                time.sleep(1)
        check("gpu job reached COMPLETED",
              bool(gpu_state) and "COMPLETED" in gpu_state,
              f"final state={gpu_state}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
