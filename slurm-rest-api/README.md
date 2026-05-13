# slurm-rest-api

Single-node Slurm cluster with REST API (`slurmrestd`) deployable via
[`conoha-cli`](https://github.com/crowdy/conoha-cli). One container runs
`munged + slurmctld + slurmd + slurmrestd + Python runtime`; a second
container runs `slurmdbd` against a `mariadb:11` accessory.

- HTTPS API via the conoha proxy / Caddy at `https://<your-fqdn>/slurm/v0.0.40/...`
- JWT (HS256) auth — token issued by `scontrol token` over SSH
- Python CLI (`examples/cli/`) for submit / status / cancel / history
- Two workload examples (`examples/workloads/`): NumPy matmul + sklearn array job

**Recommended flavor:** `g2l-t-2` (2 GB). The defaults in `slurm.conf`
declare `CPUs=2 RealMemory=1024`; raise these on larger VMs.

## Quick start

```bash
# 1. Create a server (skip if you already have one)
conoha server create --name myserver --flavor g2l-t-2 --image ubuntu-24.04 --key mykey

# 2. Edit conoha.yml: set hosts: to your FQDN (with an A record pointing to the VM)

# 3. Start the proxy (once per server)
conoha proxy boot --acme-email you@example.com myserver

# 4. Deploy
cd slurm-rest-api
cp .env.example .env   # edit the two passwords
conoha app init myserver
conoha app deploy myserver

# 5. Bootstrap the JWT token
mkdir -p ~/.slurm-api
echo "https://slurm.example.com" > ~/.slurm-api/endpoint
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token

# 6. Install CLI deps
cd examples/cli
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 7. Try it
./slurm_cli.py nodes
./slurm_cli.py submit ../workloads/numpy_matmul.py --cpus 2 --inline
./slurm_cli.py status
./slurm_cli.py submit ../workloads/hyperparam_sweep.py --array 0-4 --inline
./slurm_cli.py history
```

## Architecture

```
HTTPS (Caddy / conoha proxy)
        |
        v
+---------------------------+
| slurm  (web, blue_green:  |
|        false)             |
|   munged + slurmctld +    |
|   slurmd + slurmrestd     |
|   :6820 (JWT)             |
+------+-----------+--------+
       | munge key | JWT HS256 key
       v           v (in-container)
+------+------+
| slurmdbd    | <-- munge --> slurmctld
| :6819       |
+------+------+
       v
+------+------+
| mariadb:11  |
+-------------+
```

Volumes:
- `munge-key` shared between `slurm` and `slurmdbd` (munge auth)
- `slurm-spool` (JWT HS256 key lives here, slurm-only)
- `slurm-log`, `mariadb-data`, `work` (`/work/scripts`, `/work/logs`, `/work/results`)

The `slurm` web service is pinned to `blue_green: false` — Slurm is
stateful (running jobs, queues, JWT/munge keys, accounting DB), so two
slots can't safely run side-by-side.

## Authentication flow

1. `entrypoint.sh` generates `/var/spool/slurm/jwt_hs256.key` on first
   boot (32 random bytes, `chmod 0600`, owned by `slurm`).
2. `slurm.conf` declares `AuthAltTypes=auth/jwt` and points at the key.
3. `slurmctld` issues tokens via `scontrol token username=<u> lifespan=<s>`.
4. `slurmrestd` validates the same token with the same key — both are
   inside the same container so the file is naturally shared.
5. Clients reach `slurmrestd` over HTTPS through the conoha proxy and
   send `Authorization: Bearer <jwt>` + `X-SLURM-USER-NAME: slurm`.

`examples/get-token.sh` is the bootstrap path:

```bash
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token
```

It runs `docker exec ... scontrol token ...` on the VM and prints the bare
token (no trailing newline). Re-run it when the lifespan expires.

## API endpoints used

| Path | Used by |
|------|---------|
| `GET  /openapi/v3` | health check (no auth) |
| `GET  /slurm/v0.0.40/nodes` | `slurm_cli.py nodes` |
| `GET  /slurm/v0.0.40/jobs` | `slurm_cli.py status` |
| `GET  /slurm/v0.0.40/job/{id}` | `slurm_cli.py status JOB_ID` |
| `POST /slurm/v0.0.40/job/submit` | `slurm_cli.py submit` |
| `DELETE /slurm/v0.0.40/job/{id}` | `slurm_cli.py cancel` |
| `GET  /slurmdb/v0.0.40/jobs` | `slurm_cli.py history` |

Full slurmrestd spec: `curl https://<your-fqdn>/openapi/v3 | jq` — or load it
into Swagger UI / Insomnia / Bruno.

## Smoke test

After deploy, run the smoke test (does submit + poll + accounting check):

```bash
SLURM_API_ENDPOINT=https://slurm.example.com \
SLURM_API_TOKEN=$(cat ~/.slurm-api/token) \
python3 tests/smoke_test.py
```

Exit 0 means all 5 checks passed.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| slurmctld dies with "Munge decode failed" | mismatched munge keys (e.g. slurmdbd has an older key) | `docker compose down -v` and redeploy — clears all volumes |
| API returns `401 Unauthorized` | JWT expired | re-run `get-token.sh` |
| Job stays `PENDING (Resources)` forever | `slurm.conf CPUs=` exceeds VM cores | lower `CPUs=` or use a bigger flavor |
| `slurmdbd` fails to connect to mariadb | `SLURM_DB_PASSWORD` mismatch between services | check `.env` is consistent and was loaded by compose |
| `slurmrestd` fails with "AuthAltTypes" error | JWT key file permission drift | `chmod 0600 /var/spool/slurm/jwt_hs256.key && chown slurm:slurm ...` |

## Out of scope (intentionally)

This is a demo. Production deployments need at minimum:
- Multi-user auth (PAM / LDAP), not the single shared `slurm` user
- Short-lived JWTs with auto-refresh
- Job isolation (cgroups, separate uid per job, `pyxis`/`singularity`)
- GPU `Gres` scheduling
- Backup slurmctld (HA)
- Real multi-node (this sample is one VM)
