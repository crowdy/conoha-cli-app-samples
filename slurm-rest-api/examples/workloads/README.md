# Workload examples

Submitted via `slurm_cli.py submit ... --inline` — the Python source is
embedded in the wrapper bash script, so no `docker cp` is needed.

Job stdout and per-task result files land in `/tmp/` **inside the
cpu-worker container** (ephemeral; wiped on container restart). The
demo doesn't mount a shared volume there because the value of having one
depends on whether you ever scale beyond one worker — out of scope here.

## `numpy_matmul.py`

Single-job NumPy matrix-multiply benchmark.

```bash
../cli/slurm_cli.py submit numpy_matmul.py --cpus 2 --mem 512 --inline
```

Tune via env vars (`MATMUL_N`, `MATMUL_ROUNDS`) or by editing the file
defaults. On `g2l-t-2`, `N=2048 rounds=3` finishes in a few seconds and
prints e.g. `elapsed=0.275s gflops=187.72`. View the output:

```bash
../cli/slurm_cli.py logs <JOB_ID>  # prints the docker exec command to run
```

## `hyperparam_sweep.py` + `collect_sweep.py`

Array job: 5 parallel tasks sweep `RandomForestClassifier(n_estimators)`
on the Iris dataset, write per-task JSON to `/tmp/sweep_<idx>.json` on
the worker that ran each task.

```bash
../cli/slurm_cli.py submit hyperparam_sweep.py --array 0-4 --cpus 1 --inline
../cli/slurm_cli.py history --limit 10   # wait for all 5 to complete
```

Aggregate (on the VM, after all 5 tasks finish — files are on the
cpu-worker's `/tmp`):

```bash
conoha server ssh myserver
WORKER=$(docker ps -qf label=com.docker.compose.service=cpu-worker)
docker exec -i "$WORKER" python3 < /path/to/collect_sweep.py
```

Or `docker cp examples/workloads/collect_sweep.py $WORKER:/tmp/` then
`docker exec $WORKER python3 /tmp/collect_sweep.py`.
