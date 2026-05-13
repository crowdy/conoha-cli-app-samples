"""Array job: sweep RandomForest n_estimators on Iris with 5-fold CV.

Submit with:
    slurm_cli.py submit hyperparam_sweep.py --array 0-4 --cpus 1 --mem 256 --inline

Each array task uses $SLURM_ARRAY_TASK_ID to pick its parameter, runs
cross-validation, and writes /work/results/sweep_<idx>.json.
"""
import json
import os

from sklearn.datasets import load_iris
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score

PARAMS = [10, 50, 100, 200, 500]

try:
    idx = int(os.environ["SLURM_ARRAY_TASK_ID"])
except KeyError:
    raise SystemExit("hyperparam_sweep.py must be submitted as an array job (--array 0-4)")

if idx < 0 or idx >= len(PARAMS):
    raise SystemExit(f"SLURM_ARRAY_TASK_ID={idx} out of range 0..{len(PARAMS)-1}")

n_estimators = PARAMS[idx]
X, y = load_iris(return_X_y=True)
clf = RandomForestClassifier(n_estimators=n_estimators, random_state=42)
scores = cross_val_score(clf, X, y, cv=5)

result = {
    "task_id": idx,
    "n_estimators": n_estimators,
    "mean_acc": float(scores.mean()),
    "std": float(scores.std()),
}
print(json.dumps(result))

os.makedirs("/work/results", exist_ok=True)
with open(f"/work/results/sweep_{idx}.json", "w") as f:
    json.dump(result, f)
