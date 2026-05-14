# slurm-rest-api

Single-node Slurm cluster with REST API (`slurmrestd`) deployable via
[`conoha-cli`](https://github.com/crowdy/conoha-cli). Built on the
maintained [`giovtorres/slurm-docker-cluster`](https://github.com/giovtorres/slurm-docker-cluster)
image (Slurm 25.11, Rocky Linux 9, JWT enabled). Seven compose services:
a tiny `slurm-edge` Caddy front (web) + the Slurm cluster as accessories
(`mariadb` + `slurmdbd` + `slurmctld` + `cpu-worker` + `gpu-worker` +
`slurmrestd`).

- HTTPS API via the conoha proxy at `https://<your-fqdn>/slurm/v0.0.42/...`
- JWT auth — token issued by `scontrol token` over SSH
- Python CLI (`examples/cli/`) for submit / status / cancel / history
- Three workload examples (`examples/workloads/`): NumPy matmul + sklearn
  array job (cpu partition) + torch CUDA check (gpu partition)
- `cpu` and `gpu` partitions on a single L4 host — schedule both CPU
  jobs and CUDA jobs from the same REST API

> **Why this base image?** Ubuntu's `slurm-wlm` package ships `slurmrestd`
> with the `rest_auth/jwt` plugin but does NOT include the `auth/jwt`
> plugin that slurmctld needs to issue and validate tokens — so JWT auth
> is impossible there. The `giovtorres/slurm-docker-cluster` image
> (Rocky 9 + Slurm built with `--with-jwt`) is the most maintained Slurm
> Docker image with JWT working end-to-end.
>
> **Why the Caddy edge?** conoha-proxy probes its upstream at
> `/healthz` and accepts only 2xx as healthy. slurmrestd requires JWT
> on every endpoint, including `/openapi/v3`, so it can't serve an
> unauthenticated probe. The `slurm-edge` Caddy sidecar answers
> `/healthz` with 200 and reverse-proxies everything else to slurmrestd
> untouched. This is the same pattern as `quickwit-otel`.
>
> **Why slurmrestd is an accessory (not the web service)?** Compose
> named volumes are project-scoped: `conoha app deploy` runs accessories
> under `<app>-accessories` and the web slot under `<app>-<slot>`. The
> Slurm services share `etc_munge`, `etc_slurm`, `var_log_slurm`, and
> `slurm_jobdir` named volumes, so they must all live in the accessory
> project. The thin Caddy edge needs no shared volume and lives in the
> web slot.

**Required flavor:** `g2l-t-c20m128g1-l4` (20 vCPU, 128 GB, L4 24 GB).
This sample's `gpu-worker` service is always-on and asks the NVIDIA
Container Runtime for `count: all` GPUs — it cannot start on a host
without a CUDA-capable GPU and the NVIDIA Container Toolkit. (If you
want to run on a CPU-only VM, comment out the `gpu-worker` block in
`compose.yml` and drop the entry from `conoha.yml#accessories`.)

The image's bundled `slurm.conf` advertises `MaxNodeCount=100`,
`GresTypes=gpu`, plus `cpu` and `gpu` NodeSets — workers self-register
under whichever partition matches their `Feature=` tag.

## Host prerequisites (NVIDIA Container Toolkit)

This sample needs the host to expose its L4 GPU to Docker. The easiest
path is the bundled `conoha gpu setup` automation, which installs the
NVIDIA Container Toolkit and the datacenter driver, then reboots and
waits for `nvidia-smi` to come back:

```bash
conoha gpu setup <server-name> --identity ~/.ssh/conoha_mykey
# → installs toolkit, runs `nvidia-ctk runtime configure --runtime=docker`,
#   installs driver via `ubuntu-drivers install --gpgpu`, reboots, and
#   verifies `nvidia-smi` lists the L4.
```

If you prefer to run it manually (or you're not using the `vmi-docker-*`
ConoHa VMI image), the equivalent steps are documented in `vllm-gpu` /
`hunyuan3d-gpu`. Sanity-check the result with:

```bash
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

If this fails, the rest of this sample will not start either — the
`gpu-worker` container requests `count: all` GPUs at create time and
the daemon will refuse to spawn it without a working NVIDIA runtime.

> **Validated combination.** This sample was last verified end-to-end on
> a ConoHa `g2l-t-c20m128g1-l4` with NVIDIA driver **595.58.03**, the
> `vmi-docker-29.2-ubuntu-24.04-amd64` image, and the gpu image's pinned
> **torch 2.12.0+cu130** (CUDA 13.0). Any driver R535+ should work — the
> torch cu13x wheels are forward-compatible — but if `torch.cuda.is_available()`
> returns `False` after a ConoHa driver bump, that triple is the known-good
> baseline to compare against. Note: `conoha gpu setup` currently installs
> the open-kernel 595 driver but pins `nvidia-utils-535`; if `nvidia-smi`
> reports a "Driver/library version mismatch", install the matching
> `nvidia-utils-595-server` to align userspace with the kernel module.

## Quick start

```bash
# 1. Create an L4 server (skip if you already have one)
conoha server create --name myserver --flavor g2l-t-c20m128g1-l4 \
    --image ubuntu-24.04 --key mykey
# In-stock errors on L4 are common — if `server create` fails after
# carving a boot volume, retry with `--volume <existing-vol-id>` to
# reuse the orphan. See the conoha-cli skill for the full pattern.

# 2. Install NVIDIA Container Toolkit + driver (~10 min, reboots once)
conoha gpu setup myserver --identity ~/.ssh/conoha_mykey

# 3. Edit conoha.yml: set hosts: to your FQDN (with an A record pointing to the VM)

# 4. Start the proxy (once per server)
conoha proxy boot --acme-email you@example.com myserver

# 5. Deploy
cd slurm-rest-api
cp .env.example .env   # edit the two passwords; use only [A-Za-z0-9_-]
conoha app init myserver
conoha app deploy myserver

# 6. Bootstrap the JWT token
mkdir -p ~/.slurm-api
echo "https://slurm.example.com" > ~/.slurm-api/endpoint
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token

# 7. Install CLI deps
cd examples/cli
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 8. Try it
./slurm_cli.py nodes
# Expect c1 IDLE and g1 IDLE with Gres=gpu:nvidia:1

# CPU
./slurm_cli.py submit ../workloads/numpy_matmul.py --cpus 2 --inline
./slurm_cli.py submit ../workloads/hyperparam_sweep.py --array 0-4 --inline

# GPU
./slurm_cli.py submit ../workloads/torch_gpu_check.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 5 --inline

./slurm_cli.py history
```

L4 VPS pricing is several times the cpu-only flavors. Tear down with
`conoha server delete --delete-boot-volume --yes <name>` after testing.

## Architecture

```
HTTPS (conoha proxy)
        |
        v
   +-------------+   (web slot, project: <app>-<slot>)
   | slurm-edge  |
   | caddy :6820 |
   |  /healthz   |---> 200 (probe target)
   |  /* (auth)  |---> reverse_proxy to slurmrestd:6820
   +------+------+
          | docker network (joined via accessories: external)
          v
   +-------------+   (accessory project: <app>-accessories)
   | slurmrestd  |
   |    :6820    |
   +------+------+
          | munge auth
          v
   +-------------+         +------------+
   |  slurmctld  |<--munge-+  slurmdbd  |
   +-+-----------+         +------+-----+
     | munge                      |
     |                            v
     |                     +------------+
     |                     |  mariadb   |
     |                     |   :3306    |
     |                     +------------+
     | munge
     +--> cpu-worker (slurmd -Z, Feature=cpu) → partition=cpu
     +--> gpu-worker (slurmd -Z, Feature=gpu, Gres=gpu:nvidia:N) → partition=gpu
                                                                  (NVIDIA Container Runtime)
```

Shared named volumes (all scoped to the accessory project):
- `etc_munge` — munge key shared by every slurm service for inter-daemon auth
- `etc_slurm` — `slurm.conf` + `slurmdbd.conf` baked into the image, plus
  the JWT HS256 key generated by slurmctld on first boot (so slurmrestd
  validates with the same key)
- `var_log_slurm` — log files
- `slurm_jobdir` — mounted at `/data` on slurmctld and cpu-worker (root-owned;
  jobs run as `slurm` and write their stdout/stderr to `/tmp` instead)
- `var_lib_mysql` — accounting DB persistence

The web slot is pinned to `blue_green: false` because the accessory
cluster behind it is stateful — running jobs, queues, munge key,
accounting DB. Two web slots could exist safely (the edge is stateless)
but there's no benefit when the backend can't be duplicated.

## Authentication flow

1. The image initializes munge and the JWT HS256 key on first boot. Both
   live in shared volumes (`etc_munge`, `etc_slurm`) accessible to every
   accessory slurm service.
2. `slurmctld` issues tokens via `scontrol token username=<u> lifespan=<s>`.
3. `slurmrestd` validates the same token with the same key — they share
   `etc_slurm` so the key file is naturally available to both.
4. Clients send `X-SLURM-USER-NAME: slurm` + `X-SLURM-USER-TOKEN: <jwt>`.
   Caddy passes both headers through verbatim. (We deliberately do *not*
   add `Authorization: Bearer` — slurmrestd's JWT plugin rejects requests
   that present both schemes simultaneously.)

`examples/get-token.sh` is the bootstrap path:

```bash
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token
```

It runs `docker exec ... scontrol token ...` against whichever container
carries the `com.docker.compose.service=slurmctld` label (project-agnostic
so both `docker compose up` and `conoha app deploy` work) and prints the
bare token. Re-run when the lifespan expires.

Note: `docker compose down -v` wipes `etc_slurm`, which regenerates the
JWT key — any pre-existing tokens become invalid.

## API endpoints used

| Path | Used by |
|------|---------|
| `GET  /healthz` | conoha-proxy health probe (handled by `slurm-edge`, no auth) |
| `GET  /openapi/v3` | smoke test step 1, OpenAPI schema (JWT required) |
| `GET  /slurm/v0.0.42/nodes/` | `slurm_cli.py nodes` |
| `GET  /slurm/v0.0.42/jobs/` | `slurm_cli.py status` |
| `GET  /slurm/v0.0.42/job/{id}` | `slurm_cli.py status JOB_ID` |
| `POST /slurm/v0.0.42/job/submit` | `slurm_cli.py submit` |
| `DELETE /slurm/v0.0.42/job/{id}` | `slurm_cli.py cancel` |
| `GET  /slurmdb/v0.0.42/jobs/` | `slurm_cli.py history` |

Full slurmrestd spec (requires a valid token):

```bash
curl -H "X-SLURM-USER-NAME: slurm" -H "X-SLURM-USER-TOKEN: $(cat ~/.slurm-api/token)" \
    https://<your-fqdn>/openapi/v3 | jq
```

## Smoke test

After deploy, run the smoke test (submit + poll + accounting check):

```bash
SLURM_API_ENDPOINT=https://slurm.example.com \
SLURM_API_TOKEN=$(cat ~/.slurm-api/token) \
python3 tests/smoke_test.py
```

Exit 0 means all 5 checks passed.

Add `SLURM_SMOKE_GPU=1` to also exercise the gpu partition (3 extra
checks: the gpu-worker is registered with `Gres=gpu:nvidia:>=1`, a
`tres_per_node=gres/gpu:1` job is accepted, and the inline torch
script completes — which by itself confirms the L4 is visible to the
container via the NVIDIA Container Toolkit):

```bash
SLURM_SMOKE_GPU=1 SLURM_API_ENDPOINT=... SLURM_API_TOKEN=... \
    python3 tests/smoke_test.py
# → 8/8 PASS
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `slurmctld` or `cpu-worker` log "Munge decode failed" | mismatched munge keys (stale volume) | `docker compose down -v` and redeploy — wipes munge keys, JWT key, accounting DB |
| API returns `401 Unauthorized` | JWT expired or `etc_slurm` was wiped | re-run `get-token.sh slurm 86400 > ~/.slurm-api/token` |
| Job stays `PENDING (Resources)` | not enough cores / memory on the worker | use a bigger flavor or shrink the job spec |
| `slurmdbd` fails to connect | `SLURM_DB_PASSWORD` mismatch between services | check `.env` is consistent and was loaded by compose |
| `slurm-edge` returns 502 | slurmrestd accessory not up yet | `docker compose logs slurmrestd`; wait for the slurmctld healthcheck to pass |
| `cpu-worker` keeps restarting | replica-detection found no DNS match | check `COMPOSE_PROJECT_NAME` is forwarded (see compose.yml) and the project name in `docker ps` matches `<project>-cpu-worker-1` |
| `gpu-worker` fails with `could not select device driver "" with capabilities: [[gpu]]` | NVIDIA Container Toolkit not installed or `nvidia-ctk runtime configure --runtime=docker` not run | re-run the host prerequisites section above, then `sudo systemctl restart docker` and redeploy |
| `gpu-worker` exits with `FATAL: slurmd-gpu requested but no /dev/nvidiaN devices are visible` | the toolkit is set up but the container saw no GPU device files (driver broken, or the nvidia runtime isn't honoring the device reservation) | `nvidia-smi` on the host, then `docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi` to confirm device passthrough — `entrypoint-gpu.sh` fails fast here on purpose rather than registering a 0-GPU node |
| GPU job stays `PENDING (Resources)` | partition=gpu requested but g1 not IDLE yet | `./slurm_cli.py nodes` and wait for `g1 ... state=IDLE gres=gpu:nvidia:1`; first start is slower than cpu-worker (cgroup + device init) |

## Out of scope (intentionally)

This is a demo. Production deployments need at minimum:
- Multi-user auth (PAM / LDAP), not the single shared `slurm` user
- Short-lived JWTs with auto-refresh
- Job isolation (cgroups, separate uid per job, `pyxis` / `singularity`)
- Backup slurmctld (HA)
- Real multi-node (this sample is one L4 VM with one cpu worker and one
  gpu worker; production GPU clusters have multiple gpu-worker replicas
  and likely multi-GPU hosts)
- A shared writable jobdir (currently jobs write stdout/results to `/tmp`,
  which is ephemeral inside the worker containers)

Note: `cpu-worker` and `slurmrestd` run with `privileged: true` (SYS_ADMIN
for cgroup management and `unshare()`). A hardened deployment would drop
to explicit `cap_add: [SYS_ADMIN]` and tune `apparmor` / `seccomp`
profiles.

Note on passwords: `.env` values for `SLURM_DB_PASSWORD` and
`MARIADB_ROOT_PASSWORD` are interpolated into shell-quoted healthcheck
commands. Stick to `[A-Za-z0-9_-]` characters; quotes / `$` / backticks
will break the healthcheck silently.
