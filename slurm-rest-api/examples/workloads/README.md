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

## `torch_gpu_check.py`

GPU smoke job. Confirms that `gpu-worker`'s slurmd registered with
`Gres=gpu:nvidia:1`, that the NVIDIA Container Toolkit handed the L4
through to the container, and that torch can run real CUDA kernels on
it. The job:

1. Prints `torch.cuda.is_available()`, device count, and device name.
2. Times a matmul on the GPU at fp32 and fp16 and reports GFLOPS.
3. Dumps a one-row `nvidia-smi --query-gpu=...` table.

Exits non-zero if no CUDA device is visible (so the job lands as FAILED
in Slurm, which is exactly what `smoke_test.py` keys off when
`SLURM_SMOKE_GPU=1`).

```bash
../cli/slurm_cli.py submit torch_gpu_check.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 5 --inline
../cli/slurm_cli.py logs <JOB_ID>   # prints the docker exec command
```

The `--gres gpu:1` flag is translated to `tres_per_node=gres/gpu:1` on
the REST API. The gpu partition is non-default in the baked
`slurm.conf` (it ships `Default=NO`), so `--partition gpu` is required.

## CFD workloads

Four fluid-dynamics solvers, all torch-on-GPU, submitted to the `gpu`
partition. Each writes a matplotlib field plot to `/tmp/slurm-<JOB_ID>.png`
inside the gpu-worker container and prints an observed physical quantity
next to its literature range. Retrieve the plot with `slurm_cli.py fetch`:

```bash
../cli/slurm_cli.py submit cfd_lbm_cylinder.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 10 --inline
# -> submitted job_id=N
../cli/slurm_cli.py status N            # wait for COMPLETED
../cli/slurm_cli.py fetch  N --server myserver --identity ~/.ssh/conoha_mykey
# -> fetched job N result -> slurm-N.png
```

Each script reads simulation parameters from environment variables (shown
per script below); the defaults are sized to finish within ~1 minute on an
L4. Run any script locally on CPU at a small grid to smoke-test it before
submitting.

### `cfd_lbm_cylinder.py` — flow past a cylinder

D2Q9 lattice-Boltzmann (BGK). Streaming is `torch.roll`, collision is
elementwise — all GPU-friendly tensor ops. Produces a von Kármán vortex
street; the PNG is the vorticity field. A wake velocity probe is FFT'd to
estimate the **Strouhal number** (`St ≈ 0.16–0.18` for `Re ≈ 100–200`).
Env: `GRID_X` (520), `GRID_Y` (180), `RE` (150), `STEPS` (60000).

### `cfd_lid_cavity.py` — lid-driven cavity

Incompressible Navier-Stokes, vorticity-streamfunction formulation. The
streamfunction Poisson equation is solved by Jacobi iteration each step.
The PNG is the streamfunction contour map (primary + corner vortices). The
observable is the **minimum u-velocity on the vertical centerline**
(Ghia et al. 1982 give `min u ≈ -0.21` for `Re=100`).
Env: `GRID` (default 64 — the configuration validated against Ghia),
`RE` (100), `STEPS` (8000), `POISSON_ITERS` (60). For larger grids bump
`POISSON_ITERS` and `STEPS` together — the Jacobi solve converges slowly
with `N`.

### `cfd_sod_shock.py` — Sod shock tube

1D compressible Euler, finite-volume HLL flux. The PNG shows the
density / velocity / pressure profiles at `t=0.2` with the **exact Riemann
solution overlaid**. The observable is the measured shock-front position
versus the analytic value.
Env: `CELLS` (2000), `TEND` (0.2), `CFL` (0.9).

### `cfd_rayleigh_benard.py` — Rayleigh-Bénard convection

2D Boussinesq convection, vorticity-streamfunction plus a temperature
transport equation; periodic in x, heated from below. The PNG is the
temperature field with a velocity quiver overlay (convection rolls). The
observable is the **Nusselt number** `Nu = 1 + <vT>` (`Nu ≈ 2.2` at
`Ra=1e4`, `≈ 3.9–4.3` at `Ra=1e5`; onset at `Ra_c ≈ 1708`).
Env: `GRID` (128, → 128×64), `RA` (1e5), `PR` (0.71), `STEPS` (20000),
`POISSON_ITERS` (120).

### Local CPU self-check

Every CFD script runs on CPU too (it falls back when CUDA is absent), so
you can smoke-test before deploying — small grids finish in seconds to a
minute:

```bash
CELLS=400                          python3 cfd_sod_shock.py
python3 cfd_lid_cavity.py          # defaults are already the validated config
GRID_X=160 GRID_Y=60 STEPS=3000    python3 cfd_lbm_cylinder.py
GRID=64 RA=1e4 STEPS=6000          python3 cfd_rayleigh_benard.py
```

Each prints its device, the observed quantity, and writes a
`cfd-<name>.png` in the current directory (no `SLURM_JOB_ID` set).
