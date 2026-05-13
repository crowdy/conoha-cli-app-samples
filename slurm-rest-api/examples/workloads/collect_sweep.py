"""Aggregate hyperparam_sweep.py results into a single table.

Run inside the slurm container:
    docker exec slurm-rest-api-slurm-1 python3 /work/scripts/collect_sweep.py
or copy this file in via `docker cp` and exec.
"""
import glob
import json
import os

paths = sorted(glob.glob("/work/results/sweep_*.json"))
if not paths:
    raise SystemExit("no sweep_*.json files in /work/results")

rows = [json.load(open(p)) for p in paths]
rows.sort(key=lambda r: r["task_id"])

print(f"{'task':<6}{'n_estimators':<14}{'mean_acc':<12}{'std':<10}")
for r in rows:
    print(f"{r['task_id']:<6}{r['n_estimators']:<14}"
          f"{r['mean_acc']:<12.4f}{r['std']:<10.4f}")
