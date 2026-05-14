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
"""
import os
import sys
import time

import requests

ENDPOINT = os.environ["SLURM_API_ENDPOINT"].rstrip("/")
TOKEN = os.environ["SLURM_API_TOKEN"]
USER = os.environ.get("SLURM_API_USER", "slurm")
API = "v0.0.42"

S = requests.Session()
S.headers.update({
    "X-SLURM-USER-NAME": USER,
    "X-SLURM-USER-TOKEN": TOKEN,
    "Accept": "application/json",
})

failures = 0


def check(label, ok, detail=""):
    global failures
    if ok:
        print(f"PASS  {label}")
    else:
        print(f"FAIL  {label}  {detail}")
        failures += 1


# 1. openapi
r = S.get(f"{ENDPOINT}/openapi/v3", timeout=15)
check("openapi/v3 returns 200", r.status_code == 200, f"status={r.status_code}")

# 2. nodes
r = S.get(f"{ENDPOINT}/slurm/{API}/nodes/", timeout=15)
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
r = S.post(f"{ENDPOINT}/slurm/{API}/job/submit", json=payload, timeout=15)
job_id = r.json().get("job_id") if r.ok else None
check("submit returned job_id", bool(job_id),
      f"status={r.status_code} body={r.text[:200]}")

# 4. wait for completion
state = None
if job_id:
    for _ in range(60):
        r = S.get(f"{ENDPOINT}/slurm/{API}/job/{job_id}", timeout=15)
        jobs = r.json().get("jobs", [])
        if jobs:
            state = jobs[0].get("job_state", [])
            if "COMPLETED" in state or "FAILED" in state:
                break
        time.sleep(1)
check("job reached COMPLETED", bool(state) and "COMPLETED" in state,
      f"final state={state}")

# Slurmdbd flushes job records on JobAcctGatherFrequency boundary plus propagation.
# Wait up to 30s for the accounting record to appear before failing the test.
time.sleep(2)

# 5. accounting
seen = False
for _ in range(30):
    r = S.get(f"{ENDPOINT}/slurmdb/{API}/jobs/", params={"users": USER}, timeout=15)
    acct_jobs = r.json().get("jobs", []) if r.ok else []
    seen = any(j.get("name") == "smoke" for j in acct_jobs)
    if seen:
        break
    time.sleep(1)
check("smoke job recorded in slurmdb",
      seen, f"count={len(acct_jobs) if 'acct_jobs' in dir() else 0}")


# ---------------------------------------------------------------------------
# Optional GPU checks (gated by SLURM_SMOKE_GPU=1). Skip silently on CPU-only
# deploys so the default smoke set stays a clean 5/5.
# ---------------------------------------------------------------------------
if os.environ.get("SLURM_SMOKE_GPU") == "1":
    # 6. gpu node visible with Gres.
    r = S.get(f"{ENDPOINT}/slurm/{API}/nodes/", timeout=15)
    nodes = r.json().get("nodes", []) if r.ok else []
    def _has_gpu_gres(n):
        # The dynamic slurmd-gpu registration produces a Gres string like
        # "gpu:nvidia:1" on the node record. Slurm exposes that via the
        # `gres` field; the slurmrestd schema returns it as a flat string.
        gres = (n.get("gres") or "") + " " + (n.get("gres_drained") or "")
        return "gpu:nvidia:" in gres and not gres.strip().endswith(":0")
    gpu_idle = any(
        _has_gpu_gres(n) and ("IDLE" in (n.get("state") or []))
        for n in nodes
    )
    check("nodes includes >=1 IDLE gpu node with Gres=gpu:nvidia:>=1",
          gpu_idle,
          "no gpu-tagged IDLE node — check gpu-worker container is healthy "
          "and registered with slurmctld")

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
        # end-to-end (driver → toolkit → cgroup → torch.cuda).
        "script": (
            "#!/bin/bash\n"
            "python3 - <<'PY'\n"
            "import sys, torch\n"
            "assert torch.cuda.is_available(), 'no cuda visible to torch'\n"
            "assert torch.cuda.device_count() >= 1\n"
            "x = torch.randn(256, 256, device='cuda') @ torch.randn(256, 256, device='cuda')\n"
            "torch.cuda.synchronize()\n"
            "print('cuda ok', torch.cuda.get_device_name(0), float(x.sum()))\n"
            "PY\n"
        ),
    }
    r = S.post(f"{ENDPOINT}/slurm/{API}/job/submit",
               json=gpu_payload, timeout=15)
    gpu_job_id = r.json().get("job_id") if r.ok else None
    check("gpu submit returned job_id", bool(gpu_job_id),
          f"status={r.status_code} body={r.text[:200]}")

    # 8. wait for completion.
    gpu_state = None
    if gpu_job_id:
        # GPU jobs need extra slack: container start + torch import is ~10–15s
        # cold-cache. Cap at 180s, which is generous on an L4.
        for _ in range(180):
            r = S.get(f"{ENDPOINT}/slurm/{API}/job/{gpu_job_id}", timeout=15)
            jobs = r.json().get("jobs", [])
            if jobs:
                gpu_state = jobs[0].get("job_state", [])
                if "COMPLETED" in gpu_state or "FAILED" in gpu_state:
                    break
            time.sleep(1)
    check("gpu job reached COMPLETED",
          bool(gpu_state) and "COMPLETED" in gpu_state,
          f"final state={gpu_state}")

sys.exit(1 if failures else 0)
