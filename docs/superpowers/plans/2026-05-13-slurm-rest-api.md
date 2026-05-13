# slurm-rest-api Sample Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-node Slurm cluster sample with REST API (slurmrestd) deployable via `conoha-cli`, exposing JWT-authenticated HTTPS API for job submission and including a Python CLI + NumPy/sklearn workload examples.

**Architecture:** One `slurm` container running munge + slurmctld + slurmd + slurmrestd + Python runtime (`web` service, `blue_green: false`). One `slurmdbd` accessory (reuses the same image with `ROLE=slurmdbd`). One `mariadb:11` accessory for `slurm_acct_db`. slurmrestd listens on `:6820` and is exposed via the conoha proxy / Caddy at HTTPS. JWT auth uses an HS256 key generated inside the slurm container; tokens are issued by `scontrol token` and fetched over SSH.

**Tech Stack:** Ubuntu 24.04, Slurm 23.x (`slurm-wlm`, `slurmrestd`), munge, MariaDB 11, Python 3.12 (`click`, `requests`, `numpy`, `scikit-learn`), Docker Compose, conoha-cli ≥ 0.3.0.

**Spec:** `docs/superpowers/specs/2026-05-13-slurm-rest-api-design.md`

---

## Task 1: Bootstrap directory skeleton

**Files:**
- Create: `slurm-rest-api/.gitignore`
- Create: `slurm-rest-api/.env.example`
- Create: `slurm-rest-api/examples/cli/slurm_client/__init__.py`
- Create: `slurm-rest-api/examples/cli/tests/__init__.py`

- [ ] **Step 1: Create directories and `.gitignore`**

Run:
```bash
mkdir -p slurm-rest-api/slurm \
         slurm-rest-api/examples/cli/slurm_client \
         slurm-rest-api/examples/cli/tests \
         slurm-rest-api/examples/workloads \
         slurm-rest-api/tests
```

Create `slurm-rest-api/.gitignore`:
```
__pycache__/
*.pyc
.pytest_cache/
.coverage
*.egg-info/
.env
.env.local
.venv/
```

- [ ] **Step 2: Create `.env.example`**

Create `slurm-rest-api/.env.example`:
```
# Copy to .env and fill in. .env is git-ignored.
SLURM_DB_PASSWORD=changeme-slurm-db
MARIADB_ROOT_PASSWORD=changeme-mariadb-root
```

- [ ] **Step 3: Create empty `__init__.py` files**

Run:
```bash
touch slurm-rest-api/examples/cli/slurm_client/__init__.py
touch slurm-rest-api/examples/cli/tests/__init__.py
```

- [ ] **Step 4: Commit skeleton**

```bash
git add slurm-rest-api/
git commit -m "feat(slurm-rest-api): bootstrap directory skeleton"
```

---

## Task 2: Slurm container Dockerfile

**Files:**
- Create: `slurm-rest-api/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `slurm-rest-api/Dockerfile`:
```dockerfile
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl netcat-openbsd procps \
        munge libmunge2 \
        slurmctld slurmd slurm-client slurmdbd slurmrestd \
        libjwt2 libjson-c5 libyaml-0-2 \
        mariadb-client \
        python3 python3-pip python3-venv \
        python3-numpy python3-sklearn python3-requests python3-click \
    && rm -rf /var/lib/apt/lists/*

# The slurm user (uid 64030) is created by the slurm-wlm package. Ensure
# /var/spool/slurm and /var/log/slurm are owned by slurm.
RUN mkdir -p /var/spool/slurm /var/log/slurm /work/scripts /work/results /work/logs \
    && chown -R slurm:slurm /var/spool/slurm /var/log/slurm /work \
    && chmod 0755 /work

COPY slurm/slurm.conf      /etc/slurm/slurm.conf
COPY slurm/cgroup.conf     /etc/slurm/cgroup.conf
COPY slurm/slurmdbd.conf   /etc/slurm/slurmdbd.conf
COPY slurm/entrypoint.sh   /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
    && chmod 0600 /etc/slurm/slurmdbd.conf \
    && chown slurm:slurm /etc/slurm/slurmdbd.conf

EXPOSE 6820 6817 6818 6819

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/Dockerfile
git commit -m "feat(slurm-rest-api): add Dockerfile (ubuntu 24.04 + slurm-wlm + python runtime)"
```

---

## Task 3: Slurm configuration files (`slurm.conf`, `cgroup.conf`)

**Files:**
- Create: `slurm-rest-api/slurm/slurm.conf`
- Create: `slurm-rest-api/slurm/cgroup.conf`

- [ ] **Step 1: Write `slurm.conf`**

Create `slurm-rest-api/slurm/slurm.conf`:
```
ClusterName=conoha
SlurmctldHost=slurm

AuthType=auth/munge
AuthAltTypes=auth/jwt
AuthAltParameters=jwt_key=/var/spool/slurm/jwt_hs256.key

CredType=cred/munge

SlurmUser=slurm
SlurmdUser=root

StateSaveLocation=/var/spool/slurm/ctld
SlurmdSpoolDir=/var/spool/slurm/d
SlurmctldPidFile=/var/run/slurmctld.pid
SlurmdPidFile=/var/run/slurmd.pid

SlurmctldPort=6817
SlurmdPort=6818

ProctrackType=proctrack/linuxproc
TaskPlugin=task/none
ReturnToService=2

SchedulerType=sched/backfill
SelectType=select/cons_tres
SelectTypeParameters=CR_CPU_Memory

AccountingStorageType=accounting_storage/slurmdbd
AccountingStorageHost=slurmdbd
AccountingStoragePort=6819
AccountingStoreFlags=job_comment

JobAcctGatherType=jobacct_gather/linux
JobAcctGatherFrequency=30

SlurmctldLogFile=/var/log/slurm/slurmctld.log
SlurmdLogFile=/var/log/slurm/slurmd.log

NodeName=slurm CPUs=2 RealMemory=1024 State=UNKNOWN
PartitionName=debug Nodes=slurm Default=YES MaxTime=INFINITE State=UP
```

- [ ] **Step 2: Write `cgroup.conf`**

Create `slurm-rest-api/slurm/cgroup.conf`:
```
CgroupAutomount=no
ConstrainCores=no
ConstrainRAMSpace=no
```

(In-container Slurm without cgroup support — the host's cgroups are not exposed to the container in a controllable way for this demo. Production deployments would enable these.)

- [ ] **Step 3: Commit**

```bash
git add slurm-rest-api/slurm/slurm.conf slurm-rest-api/slurm/cgroup.conf
git commit -m "feat(slurm-rest-api): add slurm.conf and cgroup.conf"
```

---

## Task 4: slurmdbd configuration

**Files:**
- Create: `slurm-rest-api/slurm/slurmdbd.conf`

- [ ] **Step 1: Write `slurmdbd.conf`**

Create `slurm-rest-api/slurm/slurmdbd.conf`:
```
AuthType=auth/munge
AuthAltTypes=auth/jwt
AuthAltParameters=jwt_key=/var/spool/slurm/jwt_hs256.key

DbdHost=slurmdbd
DbdPort=6819

SlurmUser=slurm

LogFile=/var/log/slurm/slurmdbd.log
PidFile=/var/run/slurmdbd.pid

StorageType=accounting_storage/mysql
StorageHost=mariadb
StoragePort=3306
StorageUser=slurm
# StoragePass is injected from $SLURM_DB_PASSWORD at container start by
# entrypoint.sh (sed-replacing the literal __SLURM_DB_PASSWORD__).
StoragePass=__SLURM_DB_PASSWORD__
StorageLoc=slurm_acct_db
```

(Slurmdbd doesn't interpolate env vars in its config; we use placeholder substitution in entrypoint.sh — same approach pdns uses in dns-server.)

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/slurm/slurmdbd.conf
git commit -m "feat(slurm-rest-api): add slurmdbd.conf with mariadb backend"
```

---

## Task 5: Container entrypoint (`entrypoint.sh`) — slurm + slurmdbd modes

**Files:**
- Create: `slurm-rest-api/slurm/entrypoint.sh`

- [ ] **Step 1: Write `entrypoint.sh`**

Create `slurm-rest-api/slurm/entrypoint.sh`:
```bash
#!/usr/bin/env bash
# Single entrypoint for both slurm and slurmdbd containers.
# $ROLE selects behavior: "slurm" (default) or "slurmdbd".
set -euo pipefail

ROLE="${ROLE:-slurm}"

ensure_munge_key() {
    if [[ ! -s /etc/munge/munge.key ]]; then
        echo "[entrypoint] generating new munge key"
        dd if=/dev/urandom bs=1 count=1024 of=/etc/munge/munge.key 2>/dev/null
    fi
    chown munge:munge /etc/munge/munge.key
    chmod 0400 /etc/munge/munge.key
}

start_munged() {
    mkdir -p /run/munge && chown munge:munge /run/munge
    runuser -u munge -- munged --force
    # Wait until socket is ready
    for _ in $(seq 1 30); do
        [[ -S /run/munge/munge.socket.2 ]] && return 0
        sleep 0.2
    done
    echo "[entrypoint] munged failed to start" >&2
    exit 1
}

ensure_jwt_key() {
    local key=/var/spool/slurm/jwt_hs256.key
    if [[ ! -s "$key" ]]; then
        echo "[entrypoint] generating new JWT HS256 key"
        dd if=/dev/urandom bs=32 count=1 of="$key" 2>/dev/null
    fi
    chown slurm:slurm "$key"
    chmod 0600 "$key"
}

wait_for() {
    local host="$1" port="$2" max="${3:-60}"
    for _ in $(seq 1 "$max"); do
        nc -z "$host" "$port" && return 0
        sleep 1
    done
    echo "[entrypoint] timed out waiting for ${host}:${port}" >&2
    exit 1
}

run_slurmdbd() {
    ensure_munge_key
    start_munged
    # Substitute placeholder for DB password
    if [[ -z "${SLURM_DB_PASSWORD:-}" ]]; then
        echo "[entrypoint] SLURM_DB_PASSWORD is required" >&2
        exit 1
    fi
    sed -i "s|__SLURM_DB_PASSWORD__|${SLURM_DB_PASSWORD}|" /etc/slurm/slurmdbd.conf
    chmod 0600 /etc/slurm/slurmdbd.conf
    chown slurm:slurm /etc/slurm/slurmdbd.conf
    wait_for mariadb 3306 120
    echo "[entrypoint] starting slurmdbd"
    exec runuser -u slurm -- slurmdbd -D
}

run_slurm() {
    ensure_munge_key
    start_munged
    ensure_jwt_key
    mkdir -p /var/spool/slurm/ctld /var/spool/slurm/d /work/logs
    chown -R slurm:slurm /var/spool/slurm /work
    wait_for slurmdbd 6819 120
    echo "[entrypoint] starting slurmctld, slurmd, slurmrestd"
    runuser -u slurm -- slurmctld -D &
    SLURMCTLD_PID=$!
    sleep 2
    slurmd -D &
    SLURMD_PID=$!
    sleep 2
    # slurmrestd runs as slurm; -a rest_auth/jwt enables JWT-only auth on the listener
    runuser -u slurm -- slurmrestd -a rest_auth/jwt 0.0.0.0:6820 &
    SLURMRESTD_PID=$!
    trap 'kill $SLURMRESTD_PID $SLURMD_PID $SLURMCTLD_PID 2>/dev/null || true' TERM INT
    # Exit if any daemon dies
    wait -n $SLURMCTLD_PID $SLURMD_PID $SLURMRESTD_PID
    EC=$?
    echo "[entrypoint] a daemon exited with code $EC; shutting down" >&2
    kill $SLURMRESTD_PID $SLURMD_PID $SLURMCTLD_PID 2>/dev/null || true
    exit $EC
}

case "$ROLE" in
    slurm)    run_slurm ;;
    slurmdbd) run_slurmdbd ;;
    *) echo "[entrypoint] unknown ROLE=$ROLE (expected: slurm | slurmdbd)" >&2; exit 1 ;;
esac
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x slurm-rest-api/slurm/entrypoint.sh
git add slurm-rest-api/slurm/entrypoint.sh
git commit -m "feat(slurm-rest-api): add unified entrypoint for slurm and slurmdbd roles"
```

---

## Task 6: compose.yml — mariadb + slurmdbd + slurm

**Files:**
- Create: `slurm-rest-api/compose.yml`

- [ ] **Step 1: Write `compose.yml`**

Create `slurm-rest-api/compose.yml`:
```yaml
services:
  slurm:
    build: .
    environment:
      - ROLE=slurm
      - SLURM_DB_PASSWORD=${SLURM_DB_PASSWORD:-changeme-slurm-db}
    expose:
      - "6820"
    volumes:
      - munge-key:/etc/munge
      - slurm-spool:/var/spool/slurm
      - slurm-log:/var/log/slurm
      - work:/work
    depends_on:
      slurmdbd:
        condition: service_healthy
    restart: unless-stopped

  slurmdbd:
    build: .
    environment:
      - ROLE=slurmdbd
      - SLURM_DB_PASSWORD=${SLURM_DB_PASSWORD:-changeme-slurm-db}
    volumes:
      - munge-key:/etc/munge
      - slurm-log:/var/log/slurm
    depends_on:
      mariadb:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "nc -z localhost 6819"]
      interval: 5s
      timeout: 5s
      retries: 24
      start_period: 30s
    restart: unless-stopped

  mariadb:
    image: mariadb:11
    environment:
      - MARIADB_DATABASE=slurm_acct_db
      - MARIADB_USER=slurm
      - MARIADB_PASSWORD=${SLURM_DB_PASSWORD:-changeme-slurm-db}
      - MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD:-changeme-mariadb-root}
    volumes:
      - mariadb-data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -uroot -p\"${MARIADB_ROOT_PASSWORD:-changeme-mariadb-root}\""]
      interval: 5s
      timeout: 5s
      retries: 24
      start_period: 30s
    restart: unless-stopped

volumes:
  munge-key:
  slurm-spool:
  slurm-log:
  mariadb-data:
  work:
```

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/compose.yml
git commit -m "feat(slurm-rest-api): add compose.yml (slurm + slurmdbd + mariadb)"
```

---

## Task 7: conoha.yml

**Files:**
- Create: `slurm-rest-api/conoha.yml`

- [ ] **Step 1: Write `conoha.yml`**

Create `slurm-rest-api/conoha.yml`:
```yaml
name: slurm-rest-api
# Replace with your own FQDN before running `conoha app init`.
hosts:
  - slurm.example.com
web:
  service: slurm
  port: 6820
  # Slurm is stateful (running jobs, queues, accounting DB). A second blue/green
  # slot would fight over munge keys, JWT keys, and the DB, so pin to a single
  # instance — same pattern as outline / gitea / hydra-python-api.
  blue_green: false
health:
  path: /openapi/v3
  # 24 × 5s = 120s, covers: mariadb -> slurmdbd -> munge -> slurmctld -> slurmrestd
  unhealthy_threshold: 24
accessories:
  - slurmdbd
  - mariadb
```

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/conoha.yml
git commit -m "feat(slurm-rest-api): add conoha.yml (stateful single-instance web)"
```

---

## Task 8: `get-token.sh` helper

**Files:**
- Create: `slurm-rest-api/examples/get-token.sh`

- [ ] **Step 1: Write `get-token.sh`**

Create `slurm-rest-api/examples/get-token.sh`:
```bash
#!/usr/bin/env bash
# Fetch a Slurm JWT token by exec'ing into the running slurm container
# and running `scontrol token`. Intended to be run on the VM via:
#
#   conoha server ssh myserver -- ./examples/get-token.sh [username] [lifespan]
#
# Defaults:
#   username = slurm
#   lifespan = 86400 seconds (1 day)
#
# Prints the bare token to stdout (no trailing newline guarantees for sed/awk
# pipelines).
set -euo pipefail

USER_NAME="${1:-slurm}"
LIFESPAN="${2:-86400}"

# Find the running slurm-rest-api_slurm container. compose's project name is
# the directory name on the VM (slurm-rest-api).
CONTAINER=$(docker ps --filter "label=com.docker.compose.service=slurm" \
                       --filter "label=com.docker.compose.project=slurm-rest-api" \
                       --format '{{.ID}}' | head -n1)

if [[ -z "${CONTAINER}" ]]; then
    echo "error: slurm container not running (compose project: slurm-rest-api)" >&2
    exit 1
fi

# `scontrol token` prints "SLURM_JWT=<token>"
docker exec -u slurm "${CONTAINER}" \
    scontrol token username="${USER_NAME}" lifespan="${LIFESPAN}" \
    | awk -F= 'NR==1 { printf "%s", $2 }'
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x slurm-rest-api/examples/get-token.sh
git add slurm-rest-api/examples/get-token.sh
git commit -m "feat(slurm-rest-api): add get-token.sh helper for JWT bootstrap"
```

---

## Task 9: CLI config module — write failing tests first

**Files:**
- Create: `slurm-rest-api/examples/cli/tests/test_config.py`

- [ ] **Step 1: Write failing tests**

Create `slurm-rest-api/examples/cli/tests/test_config.py`:
```python
import os
import pathlib
import pytest

from slurm_client.config import resolve_config, Config


def test_flags_take_precedence_over_env_and_files(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_API_ENDPOINT", "https://from-env.example.com")
    monkeypatch.setenv("SLURM_API_TOKEN", "from-env-token")
    monkeypatch.setenv("SLURM_API_USER", "from-env-user")
    cfg = resolve_config(
        cli_endpoint="https://from-flag.example.com",
        cli_token="from-flag-token",
        cli_user="from-flag-user",
        config_dir=tmp_path,
    )
    assert cfg == Config(
        endpoint="https://from-flag.example.com",
        token="from-flag-token",
        user="from-flag-user",
    )


def test_env_takes_precedence_over_files(tmp_path, monkeypatch):
    (tmp_path / "endpoint").write_text("https://from-file.example.com\n")
    (tmp_path / "token").write_text("from-file-token\n")
    monkeypatch.setenv("SLURM_API_ENDPOINT", "https://from-env.example.com")
    monkeypatch.setenv("SLURM_API_TOKEN", "from-env-token")
    monkeypatch.delenv("SLURM_API_USER", raising=False)
    cfg = resolve_config(
        cli_endpoint=None,
        cli_token=None,
        cli_user=None,
        config_dir=tmp_path,
    )
    assert cfg.endpoint == "https://from-env.example.com"
    assert cfg.token == "from-env-token"
    assert cfg.user == "slurm"  # default


def test_files_used_when_no_flags_or_env(tmp_path, monkeypatch):
    (tmp_path / "endpoint").write_text("https://from-file.example.com\n")
    (tmp_path / "token").write_text("from-file-token\n")
    for k in ("SLURM_API_ENDPOINT", "SLURM_API_TOKEN", "SLURM_API_USER"):
        monkeypatch.delenv(k, raising=False)
    cfg = resolve_config(
        cli_endpoint=None,
        cli_token=None,
        cli_user=None,
        config_dir=tmp_path,
    )
    assert cfg.endpoint == "https://from-file.example.com"
    assert cfg.token == "from-file-token"
    assert cfg.user == "slurm"


def test_missing_endpoint_raises(tmp_path, monkeypatch):
    for k in ("SLURM_API_ENDPOINT", "SLURM_API_TOKEN", "SLURM_API_USER"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(RuntimeError, match="endpoint"):
        resolve_config(None, None, None, config_dir=tmp_path)


def test_endpoint_strips_trailing_slash(tmp_path, monkeypatch):
    monkeypatch.setenv("SLURM_API_ENDPOINT", "https://x.example.com/")
    monkeypatch.setenv("SLURM_API_TOKEN", "t")
    monkeypatch.delenv("SLURM_API_USER", raising=False)
    cfg = resolve_config(None, None, None, config_dir=tmp_path)
    assert cfg.endpoint == "https://x.example.com"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd slurm-rest-api/examples/cli && python -m pytest tests/test_config.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'slurm_client.config'`

---

## Task 10: CLI config module — make tests pass

**Files:**
- Create: `slurm-rest-api/examples/cli/slurm_client/config.py`

- [ ] **Step 1: Implement `Config` and `resolve_config`**

Create `slurm-rest-api/examples/cli/slurm_client/config.py`:
```python
"""Resolve CLI configuration from flags, env vars, and ~/.slurm-api/ files.

Priority (highest first):
1. CLI flags (--endpoint, --token, --user)
2. Environment variables (SLURM_API_ENDPOINT, SLURM_API_TOKEN, SLURM_API_USER)
3. Files in config_dir (endpoint, token; user defaults to 'slurm')
"""
from __future__ import annotations

import os
import pathlib
from dataclasses import dataclass
from typing import Optional


DEFAULT_USER = "slurm"


@dataclass(frozen=True)
class Config:
    endpoint: str
    token: str
    user: str


def _read_file(path: pathlib.Path) -> Optional[str]:
    if not path.exists():
        return None
    text = path.read_text().strip()
    return text or None


def resolve_config(
    cli_endpoint: Optional[str],
    cli_token: Optional[str],
    cli_user: Optional[str],
    config_dir: Optional[pathlib.Path] = None,
) -> Config:
    if config_dir is None:
        config_dir = pathlib.Path.home() / ".slurm-api"

    endpoint = (
        cli_endpoint
        or os.environ.get("SLURM_API_ENDPOINT")
        or _read_file(config_dir / "endpoint")
    )
    token = (
        cli_token
        or os.environ.get("SLURM_API_TOKEN")
        or _read_file(config_dir / "token")
    )
    user = (
        cli_user
        or os.environ.get("SLURM_API_USER")
        or DEFAULT_USER
    )

    if not endpoint:
        raise RuntimeError(
            "Slurm API endpoint not configured. "
            "Set --endpoint, SLURM_API_ENDPOINT, or write "
            f"{config_dir / 'endpoint'}"
        )
    if not token:
        raise RuntimeError(
            "Slurm API token not configured. "
            "Set --token, SLURM_API_TOKEN, or write "
            f"{config_dir / 'token'}"
        )

    return Config(endpoint=endpoint.rstrip("/"), token=token, user=user)
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd slurm-rest-api/examples/cli && python -m pytest tests/test_config.py -v
```

Expected: 5 passed.

- [ ] **Step 3: Commit**

```bash
git add slurm-rest-api/examples/cli/slurm_client/config.py \
        slurm-rest-api/examples/cli/tests/test_config.py
git commit -m "feat(slurm-rest-api): add CLI config resolver (flags > env > files)"
```

---

## Task 11: CLI payload builder — write failing tests first

**Files:**
- Create: `slurm-rest-api/examples/cli/tests/test_payload.py`

- [ ] **Step 1: Write failing tests**

Create `slurm-rest-api/examples/cli/tests/test_payload.py`:
```python
import pytest

from slurm_client.payload import build_submit_payload


def test_minimal_inline_payload():
    script_body = "print('hello')\n"
    payload = build_submit_payload(
        name="hello",
        script_body=script_body,
        cpus=1,
        memory_mb=128,
        time_limit_min=5,
        array=None,
        inline=True,
    )
    job = payload["job"]
    assert job["name"] == "hello"
    assert job["partition"] == "debug"
    assert job["cpus_per_task"] == 1
    assert job["memory_per_node"] == 128
    assert job["time_limit"] == 5
    assert "array" not in job
    assert job["current_working_directory"] == "/work"
    assert job["standard_output"] == "/work/logs/%j.out"
    assert job["standard_error"] == "/work/logs/%j.err"
    assert payload["script"].startswith("#!/bin/bash\n")
    assert "print('hello')" in payload["script"]


def test_array_payload_includes_array_field():
    payload = build_submit_payload(
        name="sweep",
        script_body="print('x')\n",
        cpus=1,
        memory_mb=128,
        time_limit_min=5,
        array="0-4",
        inline=True,
    )
    assert payload["job"]["array"] == "0-4"


def test_non_inline_payload_uses_file_path():
    payload = build_submit_payload(
        name="workload",
        script_body=None,
        cpus=2,
        memory_mb=512,
        time_limit_min=10,
        array=None,
        inline=False,
        script_path="/work/scripts/workload.py",
    )
    assert payload["script"] == "#!/bin/bash\npython3 /work/scripts/workload.py\n"


def test_inline_requires_script_body():
    with pytest.raises(ValueError, match="script_body"):
        build_submit_payload(
            name="x", script_body=None, cpus=1, memory_mb=128,
            time_limit_min=5, array=None, inline=True,
        )


def test_non_inline_requires_script_path():
    with pytest.raises(ValueError, match="script_path"):
        build_submit_payload(
            name="x", script_body=None, cpus=1, memory_mb=128,
            time_limit_min=5, array=None, inline=False,
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd slurm-rest-api/examples/cli && python -m pytest tests/test_payload.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'slurm_client.payload'`

---

## Task 12: CLI payload builder — implement

**Files:**
- Create: `slurm-rest-api/examples/cli/slurm_client/payload.py`

- [ ] **Step 1: Implement `build_submit_payload`**

Create `slurm-rest-api/examples/cli/slurm_client/payload.py`:
```python
"""Build slurmrestd job-submit payloads.

Two modes:
- inline=True: embed Python source as a heredoc inside the wrapper bash script
- inline=False: wrapper bash script runs `python3 <script_path>` (the file
  must already exist inside the container at /work/scripts/<name>)
"""
from __future__ import annotations

from typing import Any, Optional


def build_submit_payload(
    *,
    name: str,
    script_body: Optional[str],
    cpus: int,
    memory_mb: int,
    time_limit_min: int,
    array: Optional[str],
    inline: bool,
    script_path: Optional[str] = None,
) -> dict[str, Any]:
    if inline:
        if not script_body:
            raise ValueError("inline mode requires script_body")
        wrapper = (
            "#!/bin/bash\n"
            "python3 - <<'__SLURM_CLI_PY_EOF__'\n"
            f"{script_body}"
            "__SLURM_CLI_PY_EOF__\n"
        )
    else:
        if not script_path:
            raise ValueError("non-inline mode requires script_path")
        wrapper = f"#!/bin/bash\npython3 {script_path}\n"

    job: dict[str, Any] = {
        "name": name,
        "partition": "debug",
        "cpus_per_task": cpus,
        "memory_per_node": memory_mb,
        "time_limit": time_limit_min,
        "current_working_directory": "/work",
        "standard_output": "/work/logs/%j.out",
        "standard_error": "/work/logs/%j.err",
        "environment": ["PATH=/usr/bin:/bin"],
    }
    if array:
        job["array"] = array

    return {"job": job, "script": wrapper}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:
```bash
cd slurm-rest-api/examples/cli && python -m pytest tests/test_payload.py -v
```

Expected: 5 passed.

- [ ] **Step 3: Commit**

```bash
git add slurm-rest-api/examples/cli/slurm_client/payload.py \
        slurm-rest-api/examples/cli/tests/test_payload.py
git commit -m "feat(slurm-rest-api): add submit-payload builder (inline + file modes)"
```

---

## Task 13: HTTP client wrapper around slurmrestd

**Files:**
- Create: `slurm-rest-api/examples/cli/slurm_client/http.py`

- [ ] **Step 1: Implement the HTTP client**

Create `slurm-rest-api/examples/cli/slurm_client/http.py`:
```python
"""Thin requests-based wrapper around the slurmrestd v0.0.40 endpoints."""
from __future__ import annotations

from typing import Any, Optional

import requests

API_VERSION = "v0.0.40"
DEFAULT_TIMEOUT = 30


class SlurmAPIError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"slurmrestd {status}: {message}")
        self.status = status


class SlurmClient:
    def __init__(self, endpoint: str, token: str, user: str,
                 timeout: int = DEFAULT_TIMEOUT):
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.user = user
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "X-SLURM-USER-NAME": user,
            "X-SLURM-USER-TOKEN": token,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })

    def _url(self, base: str, path: str) -> str:
        return f"{self.endpoint}/{base}/{API_VERSION}{path}"

    def _check(self, r: requests.Response) -> dict[str, Any]:
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400:
            err = (data.get("errors") or [{"description": r.text}])[0]
            raise SlurmAPIError(r.status_code, err.get("description", "unknown"))
        return data

    def health(self) -> bool:
        r = self._session.get(f"{self.endpoint}/openapi/v3",
                              timeout=self.timeout)
        return r.status_code == 200

    def nodes(self) -> dict[str, Any]:
        r = self._session.get(self._url("slurm", "/nodes"),
                              timeout=self.timeout)
        return self._check(r)

    def jobs(self, job_id: Optional[int] = None) -> dict[str, Any]:
        path = f"/job/{job_id}" if job_id is not None else "/jobs"
        r = self._session.get(self._url("slurm", path), timeout=self.timeout)
        return self._check(r)

    def submit(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = self._session.post(self._url("slurm", "/job/submit"),
                               json=payload, timeout=self.timeout)
        return self._check(r)

    def cancel(self, job_id: int) -> dict[str, Any]:
        r = self._session.delete(self._url("slurm", f"/job/{job_id}"),
                                 timeout=self.timeout)
        return self._check(r)

    def history(self, limit: int = 20) -> dict[str, Any]:
        # slurmdbd jobs endpoint; users param filters to current user.
        r = self._session.get(
            self._url("slurmdb", "/jobs"),
            params={"users": self.user},
            timeout=self.timeout,
        )
        data = self._check(r)
        jobs = data.get("jobs", [])[:limit]
        return {"jobs": jobs}
```

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/examples/cli/slurm_client/http.py
git commit -m "feat(slurm-rest-api): add SlurmClient HTTP wrapper (slurmrestd v0.0.40)"
```

---

## Task 14: CLI entry point (`slurm_cli.py`)

**Files:**
- Create: `slurm-rest-api/examples/cli/slurm_cli.py`
- Create: `slurm-rest-api/examples/cli/requirements.txt`

- [ ] **Step 1: Write `requirements.txt`**

Create `slurm-rest-api/examples/cli/requirements.txt`:
```
click>=8.1
requests>=2.32
```

- [ ] **Step 2: Write `slurm_cli.py`**

Create `slurm-rest-api/examples/cli/slurm_cli.py`:
```python
#!/usr/bin/env python3
"""Slurm REST API CLI client.

Subcommands:
  nodes           List cluster nodes and state
  status [JOB]    Show queue (no arg) or single job
  submit SCRIPT   Submit a Python script as a Slurm job
  cancel JOB      Cancel a job
  history         List recent jobs from slurmdbd accounting
"""
from __future__ import annotations

import json
import pathlib
import sys

import click

from slurm_client.config import resolve_config
from slurm_client.http import SlurmAPIError, SlurmClient
from slurm_client.payload import build_submit_payload


def _client(ctx: click.Context) -> SlurmClient:
    cfg = ctx.obj["config"]
    return SlurmClient(cfg.endpoint, cfg.token, cfg.user)


def _print_json(data) -> None:
    click.echo(json.dumps(data, indent=2, sort_keys=True))


@click.group()
@click.option("--endpoint", default=None, help="API base URL (overrides env/file)")
@click.option("--token", default=None, help="JWT token (overrides env/file)")
@click.option("--user", default=None, help="X-SLURM-USER-NAME (defaults to 'slurm')")
@click.pass_context
def cli(ctx: click.Context, endpoint, token, user) -> None:
    try:
        cfg = resolve_config(endpoint, token, user)
    except RuntimeError as e:
        click.echo(f"error: {e}", err=True)
        sys.exit(2)
    ctx.obj = {"config": cfg}


@cli.command()
@click.pass_context
def nodes(ctx):
    """List cluster nodes and state."""
    try:
        data = _client(ctx).nodes()
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    rows = data.get("nodes", [])
    for n in rows:
        click.echo(
            f"{n.get('name', '?'):<16} "
            f"state={','.join(n.get('state', []))} "
            f"cpus={n.get('cpus', '?')} "
            f"mem={n.get('real_memory', '?')}MB"
        )
    if not rows:
        click.echo("(no nodes)")


@cli.command()
@click.argument("job_id", type=int, required=False)
@click.pass_context
def status(ctx, job_id):
    """Show queue or a single job's status."""
    try:
        data = _client(ctx).jobs(job_id)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    for j in data.get("jobs", []):
        click.echo(
            f"{j.get('job_id'):<8} "
            f"{','.join(j.get('job_state', [])):<12} "
            f"{j.get('name', ''):<20} "
            f"user={j.get('user_name', '')} "
            f"part={j.get('partition', '')}"
        )


@cli.command()
@click.argument("script", type=click.Path(exists=True, dir_okay=False, path_type=pathlib.Path))
@click.option("--cpus", default=1, show_default=True, type=int)
@click.option("--mem", "memory_mb", default=256, show_default=True, type=int,
              help="Memory per node (MB)")
@click.option("--time", "time_limit_min", default=10, show_default=True, type=int,
              help="Time limit (minutes)")
@click.option("--array", default=None, help="Array spec, e.g. '0-4'")
@click.option("--name", default=None, help="Job name (defaults to script stem)")
@click.option("--inline/--no-inline", default=True,
              help="--inline (default) embeds the Python source in the job script. "
                   "--no-inline expects /work/scripts/<script_basename> to already "
                   "exist in the container.")
@click.pass_context
def submit(ctx, script: pathlib.Path, cpus, memory_mb, time_limit_min, array, name, inline):
    """Submit a Python script as a Slurm job."""
    name = name or script.stem
    script_body = script.read_text() if inline else None
    script_path = None if inline else f"/work/scripts/{script.name}"
    payload = build_submit_payload(
        name=name, script_body=script_body, cpus=cpus, memory_mb=memory_mb,
        time_limit_min=time_limit_min, array=array, inline=inline,
        script_path=script_path,
    )
    try:
        data = _client(ctx).submit(payload)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    job_id = data.get("job_id")
    if job_id:
        click.echo(f"submitted job_id={job_id} name={name}")
    else:
        _print_json(data)


@cli.command()
@click.argument("job_id", type=int)
@click.pass_context
def cancel(ctx, job_id):
    """Cancel a job."""
    try:
        _client(ctx).cancel(job_id)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    click.echo(f"cancelled job_id={job_id}")


@cli.command()
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def history(ctx, limit):
    """List recent finished jobs from slurmdbd accounting."""
    try:
        data = _client(ctx).history(limit=limit)
    except SlurmAPIError as e:
        click.echo(f"error: {e}", err=True); sys.exit(1)
    for j in data.get("jobs", []):
        click.echo(
            f"{j.get('job_id'):<8} "
            f"{j.get('state', {}).get('current', ['?'])[0]:<12} "
            f"{j.get('name', ''):<20} "
            f"start={j.get('time', {}).get('start', 0)} "
            f"end={j.get('time', {}).get('end', 0)}"
        )


@cli.command()
def logs():
    """Logs are not retrievable through slurmrestd. SSH to the VM and use:

    \b
      docker exec -it $(docker ps -qf label=com.docker.compose.service=slurm) \\
          cat /work/logs/<job_id>.out
    """
    click.echo(logs.__doc__)


if __name__ == "__main__":
    cli()
```

- [ ] **Step 3: Make executable and commit**

```bash
chmod +x slurm-rest-api/examples/cli/slurm_cli.py
git add slurm-rest-api/examples/cli/slurm_cli.py \
        slurm-rest-api/examples/cli/requirements.txt
git commit -m "feat(slurm-rest-api): add Python CLI (nodes/status/submit/cancel/history)"
```

---

## Task 15: NumPy matmul workload

**Files:**
- Create: `slurm-rest-api/examples/workloads/numpy_matmul.py`

- [ ] **Step 1: Write `numpy_matmul.py`**

Create `slurm-rest-api/examples/workloads/numpy_matmul.py`:
```python
"""Matrix-multiply benchmark.

Submit with:
    slurm_cli.py submit numpy_matmul.py --cpus 2 --mem 512 --inline

Tune via env (slurm submit can pass with --export, omitted in this demo
for simplicity — defaults are fine for g2l-t-2).
"""
import os
import time

import numpy as np

N = int(os.environ.get("MATMUL_N", "2048"))
ROUNDS = int(os.environ.get("MATMUL_ROUNDS", "3"))

print(f"matmul: N={N} rounds={ROUNDS}")
a = np.random.rand(N, N).astype(np.float32)
b = np.random.rand(N, N).astype(np.float32)

t0 = time.perf_counter()
for i in range(ROUNDS):
    c = a @ b
elapsed = time.perf_counter() - t0
gflops = (2 * N**3 * ROUNDS) / elapsed / 1e9
print(f"elapsed={elapsed:.3f}s gflops={gflops:.2f}")
```

(N=2048 default to fit comfortably in 1GB RealMemory; can be raised on larger flavors.)

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/examples/workloads/numpy_matmul.py
git commit -m "feat(slurm-rest-api): add numpy_matmul workload example"
```

---

## Task 16: Hyperparameter sweep + collector

**Files:**
- Create: `slurm-rest-api/examples/workloads/hyperparam_sweep.py`
- Create: `slurm-rest-api/examples/workloads/collect_sweep.py`

- [ ] **Step 1: Write `hyperparam_sweep.py`**

Create `slurm-rest-api/examples/workloads/hyperparam_sweep.py`:
```python
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
```

- [ ] **Step 2: Write `collect_sweep.py`**

Create `slurm-rest-api/examples/workloads/collect_sweep.py`:
```python
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
```

- [ ] **Step 3: Commit**

```bash
git add slurm-rest-api/examples/workloads/hyperparam_sweep.py \
        slurm-rest-api/examples/workloads/collect_sweep.py
git commit -m "feat(slurm-rest-api): add hyperparam_sweep array job + collector"
```

---

## Task 17: Smoke test

**Files:**
- Create: `slurm-rest-api/tests/smoke_test.py`

- [ ] **Step 1: Write `smoke_test.py`**

Create `slurm-rest-api/tests/smoke_test.py`:
```python
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
```

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/tests/smoke_test.py
git commit -m "feat(slurm-rest-api): add manual smoke test against deployed stack"
```

---

## Task 18: examples/cli/README.md and examples/workloads/README.md

**Files:**
- Create: `slurm-rest-api/examples/cli/README.md`
- Create: `slurm-rest-api/examples/workloads/README.md`

- [ ] **Step 1: Write `examples/cli/README.md`**

Create `slurm-rest-api/examples/cli/README.md`:
````markdown
# slurm_cli.py

Python client for the deployed Slurm REST API.

## Install

```bash
cd examples/cli
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Configure

The CLI reads endpoint / token / user with this precedence:

1. CLI flags (`--endpoint`, `--token`, `--user`)
2. Env vars (`SLURM_API_ENDPOINT`, `SLURM_API_TOKEN`, `SLURM_API_USER`)
3. Files (`~/.slurm-api/endpoint`, `~/.slurm-api/token`; user defaults to `slurm`)

Typical setup after deploy:

```bash
mkdir -p ~/.slurm-api
echo "https://slurm.example.com" > ~/.slurm-api/endpoint
conoha server ssh myserver -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token
```

## Commands

```bash
./slurm_cli.py nodes
./slurm_cli.py status [JOB_ID]
./slurm_cli.py submit ../workloads/numpy_matmul.py --cpus 2 --mem 512 --inline
./slurm_cli.py submit ../workloads/hyperparam_sweep.py --array 0-4 --inline
./slurm_cli.py cancel JOB_ID
./slurm_cli.py history --limit 20
./slurm_cli.py logs   # prints SSH instructions; slurmrestd does not stream logs
```

## Tests

```bash
python -m pytest tests/ -v
```
````

- [ ] **Step 2: Write `examples/workloads/README.md`**

Create `slurm-rest-api/examples/workloads/README.md`:
````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add slurm-rest-api/examples/cli/README.md \
        slurm-rest-api/examples/workloads/README.md
git commit -m "docs(slurm-rest-api): add example READMEs (cli + workloads)"
```

---

## Task 19: Top-level sample README

**Files:**
- Create: `slurm-rest-api/README.md`

- [ ] **Step 1: Write `slurm-rest-api/README.md`**

Create `slurm-rest-api/README.md`:
````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add slurm-rest-api/README.md
git commit -m "docs(slurm-rest-api): add sample README with quickstart + troubleshooting"
```

---

## Task 20: Register sample in root README

**Files:**
- Modify: `README.md` (the repo root)

- [ ] **Step 1: Add row to the "サンプル一覧" table**

In `README.md`, locate the table that ends with the `meilisearch` row (around line 91 in the version this plan was written against) and insert a new row immediately after it:

```markdown
| [slurm-rest-api](slurm-rest-api/) | Slurm + slurmrestd + slurmdbd + MariaDB | Slurm 単一ノードクラスター + REST API (JWT 認証、Python CLI + NumPy/sklearn ワークロード例) | g2l-t-2 (2GB) |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: register slurm-rest-api sample in root README"
```

---

## Task 21: End-to-end deployment verification (manual, after merge)

This task is intentionally not automated. It is the human checkpoint that
exercises the whole stack against a real VPS.

- [ ] **Step 1: Provision a test VM**

```bash
conoha server create --name slurm-test --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
conoha proxy boot --acme-email you@example.com slurm-test
```

Update DNS so a chosen FQDN points at the VM. Edit `slurm-rest-api/conoha.yml`
to use that FQDN.

- [ ] **Step 2: Deploy**

```bash
cd slurm-rest-api
cp .env.example .env
# edit .env: set SLURM_DB_PASSWORD and MARIADB_ROOT_PASSWORD to fresh random values
conoha app init slurm-test
conoha app deploy slurm-test
```

Wait until `conoha app status slurm-test` reports the web slot healthy
(the health check polls `/openapi/v3`; full boot takes 60–120s).

- [ ] **Step 3: Bootstrap and run smoke test**

```bash
mkdir -p ~/.slurm-api
echo "https://<your-fqdn>" > ~/.slurm-api/endpoint
conoha server ssh slurm-test -- ./examples/get-token.sh slurm 86400 \
    > ~/.slurm-api/token

SLURM_API_ENDPOINT=$(cat ~/.slurm-api/endpoint) \
SLURM_API_TOKEN=$(cat ~/.slurm-api/token) \
python3 tests/smoke_test.py
```

Expected: 5 PASS lines, exit 0.

- [ ] **Step 4: Run workload examples**

```bash
cd examples/cli
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

./slurm_cli.py nodes
./slurm_cli.py submit ../workloads/numpy_matmul.py --cpus 2 --inline
./slurm_cli.py status
./slurm_cli.py submit ../workloads/hyperparam_sweep.py --array 0-4 --inline
sleep 30
./slurm_cli.py history --limit 10
```

Expected: matmul prints GFLOPS, history shows 5 array tasks COMPLETED.

- [ ] **Step 5: Tear down**

```bash
conoha server delete slurm-test --yes
```

(If any step in the manual verification surfaces a defect, fix it in code
and re-run from Step 2.)
