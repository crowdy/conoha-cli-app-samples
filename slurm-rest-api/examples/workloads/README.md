# Workload examples

Submitted via `slurm_cli.py submit ... --inline` — the Python source is
embedded in the wrapper bash script, so no `docker cp` is needed.

## `numpy_matmul.py`

Single-job NumPy matrix-multiply benchmark.

```bash
../cli/slurm_cli.py submit numpy_matmul.py --cpus 2 --mem 512 --inline
```

Tune size with env (set inside the wrapper before submit, or edit
`MATMUL_N` / `MATMUL_ROUNDS` defaults in the file). On `g2l-t-2`,
`N=2048 rounds=3` finishes in a few seconds.

## `hyperparam_sweep.py` + `collect_sweep.py`

Array job: 5 parallel tasks sweep `RandomForestClassifier(n_estimators)`
on the Iris dataset, write per-task JSON to `/work/results/`.

```bash
../cli/slurm_cli.py submit hyperparam_sweep.py --array 0-4 --cpus 1 --inline
../cli/slurm_cli.py history --limit 10   # wait for all 5 to complete
```

Aggregate inside the container:

```bash
conoha server ssh myserver
docker cp examples/workloads/collect_sweep.py \
    $(docker ps -qf label=com.docker.compose.service=slurm):/work/scripts/
docker exec $(docker ps -qf label=com.docker.compose.service=slurm) \
    python3 /work/scripts/collect_sweep.py
```
