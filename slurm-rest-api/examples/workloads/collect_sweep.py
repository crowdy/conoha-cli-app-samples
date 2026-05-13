"""Aggregate hyperparam_sweep.py results into a single table.

Each sweep task writes /tmp/sweep_<idx>.json on the cpu-worker that ran
it. Run this collector inside the cpu-worker container:

    docker exec -i $(docker ps -qf label=com.docker.compose.service=cpu-worker) \
        python3 < examples/workloads/collect_sweep.py
"""
import glob
import json

paths = sorted(glob.glob("/tmp/sweep_*.json"))
if not paths:
    raise SystemExit("no sweep_*.json files in /tmp on this worker")

rows = []
for p in paths:
    with open(p) as f:
        rows.append(json.load(f))
rows.sort(key=lambda r: r["task_id"])

print(f"{'task':<6}{'n_estimators':<14}{'mean_acc':<12}{'std':<10}")
for r in rows:
    print(f"{r['task_id']:<6}{r['n_estimators']:<14}"
          f"{r['mean_acc']:<12.4f}{r['std']:<10.4f}")
