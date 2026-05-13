"""Manual smoke test against a deployed slurm-rest-api stack.

Usage:
    SLURM_API_ENDPOINT=https://slurm.example.com \
    SLURM_API_TOKEN=$(cat ~/.slurm-api/token) \
    python3 tests/smoke_test.py

Checks (each prints PASS/FAIL):
    1. /openapi/v3 returns 200
    2. GET /slurm/v0.0.40/nodes returns >= 1 node and one is IDLE
    3. POST /job/submit accepts a trivial 'echo hello smoke' job
    4. Job transitions to COMPLETED within 60s
    5. /slurmdb/v0.0.40/jobs includes the smoke job
"""
import os
import sys
import time

import requests

ENDPOINT = os.environ["SLURM_API_ENDPOINT"].rstrip("/")
TOKEN = os.environ["SLURM_API_TOKEN"]
USER = os.environ.get("SLURM_API_USER", "slurm")
API = "v0.0.40"

S = requests.Session()
S.headers.update({
    "X-SLURM-USER-NAME": USER,
    "X-SLURM-USER-TOKEN": TOKEN,
    "Authorization": f"Bearer {TOKEN}",
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
r = S.get(f"{ENDPOINT}/slurm/{API}/nodes", timeout=15)
nodes = r.json().get("nodes", []) if r.ok else []
idle = any("IDLE" in (n.get("state") or []) for n in nodes)
check("nodes includes >=1 IDLE", r.ok and idle,
      f"status={r.status_code} count={len(nodes)} idle={idle}")

# 3. submit
payload = {
    "job": {
        "name": "smoke",
        "partition": "debug",
        "cpus_per_task": 1,
        "memory_per_node": 64,
        "time_limit": 1,
        "current_working_directory": "/work",
        "standard_output": "/work/logs/%j.out",
        "standard_error": "/work/logs/%j.err",
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

# 5. accounting
r = S.get(f"{ENDPOINT}/slurmdb/{API}/jobs", params={"users": USER}, timeout=15)
acct_jobs = r.json().get("jobs", []) if r.ok else []
seen = any(j.get("name") == "smoke" for j in acct_jobs)
check("smoke job recorded in slurmdb",
      seen, f"status={r.status_code} count={len(acct_jobs)}")

sys.exit(1 if failures else 0)
