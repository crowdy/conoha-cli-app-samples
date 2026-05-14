# CFD Workloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 fluid-dynamics workload examples to the `slurm-rest-api` sample that run as Slurm GPU jobs and return matplotlib field plots retrievable with a new `slurm_cli.py fetch` command.

**Architecture:** Each CFD problem is a self-contained torch-on-GPU Python script in `examples/workloads/`, submitted `--inline` to the `gpu` partition. Scripts write a PNG to `/tmp/slurm-$SLURM_JOB_ID.png` and print an observed physical quantity next to its literature range. `slurm_cli.py fetch` SSHes to the VM and `docker exec ... cat`s the PNG to a local file. The gpu Docker stage gains `matplotlib`.

**Tech Stack:** Python 3.12, PyTorch (CUDA), matplotlib (Agg), numpy, click, Slurm 25.11 / slurmrestd v0.0.42, the `giovtorres/slurm-docker-cluster` base image.

**Spec:** `docs/superpowers/specs/2026-05-14-cfd-workloads-design.md`

**Branch:** `feat/slurm-rest-api-cfd-workloads` (already created, stacked on `feat/slurm-rest-api-gpu-worker` / PR #103). All work happens on this branch.

**Working directory:** All paths below are relative to the repo root `/root/dev/crowdy/conoha-cli-app-samples` unless stated otherwise.

---

## Task 1: Add matplotlib to the gpu Docker stage

**Files:**
- Modify: `slurm-rest-api/Dockerfile`

- [ ] **Step 1: Read the current Dockerfile**

Run: `cat slurm-rest-api/Dockerfile`
Expected: a multi-stage file with `base`, `cpu`, `gpu` stages; the `gpu` stage currently runs `python3 -m pip install --no-cache-dir torch`.

- [ ] **Step 2: Add matplotlib to the gpu stage pip install**

In `slurm-rest-api/Dockerfile`, change the gpu stage's pip line from:

```dockerfile
RUN python3 -m pip install --no-cache-dir torch
```

to:

```dockerfile
RUN python3 -m pip install --no-cache-dir torch matplotlib
```

Leave the rest of the gpu stage (the `COPY entrypoint-gpu.sh`, `chmod`, `ENTRYPOINT` lines) unchanged. Do not touch the `base` or `cpu` stages.

- [ ] **Step 3: Verify the cpu stage still builds (fast — no torch)**

Run: `cd slurm-rest-api && docker build --target cpu -t slurm-rest-api:local . && cd ..`
Expected: build succeeds. This confirms the multi-stage file is still syntactically valid. The full `gpu` stage build (torch + matplotlib, ~2.5 GB) is exercised on the real L4 in Task 9 — do not build it here.

- [ ] **Step 4: Commit**

```bash
git add slurm-rest-api/Dockerfile
git commit -m "feat(slurm-rest-api): add matplotlib to gpu image for CFD workloads"
```

---

## Task 2: `build_fetch_command` pure function + unit test

**Files:**
- Create: `slurm-rest-api/examples/cli/slurm_client/fetch.py`
- Create: `slurm-rest-api/examples/cli/tests/test_fetch.py`

- [ ] **Step 1: Write the failing test**

Create `slurm-rest-api/examples/cli/tests/test_fetch.py`:

```python
"""Unit tests for slurm_client.fetch pure helpers."""
import pytest

from slurm_client.fetch import build_fetch_command


def test_basic_command_uses_label_and_remote_path():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/slurm-42.png", ssh_user="root",
    )
    assert cmd[0] == "ssh"
    assert "root@203.0.113.5" in cmd
    # the remote command must find the gpu-worker by compose service label
    remote = cmd[-1]
    assert "com.docker.compose.service=gpu-worker" in remote
    assert "cat /tmp/slurm-42.png" in remote


def test_identity_is_passed_as_dash_i():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity="/home/u/.ssh/key",
        remote_path="/tmp/slurm-1.png", ssh_user="root",
    )
    assert "-i" in cmd
    assert cmd[cmd.index("-i") + 1] == "/home/u/.ssh/key"


def test_no_identity_omits_dash_i():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/slurm-1.png", ssh_user="root",
    )
    assert "-i" not in cmd


def test_custom_ssh_user():
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/slurm-1.png", ssh_user="ubuntu",
    )
    assert "ubuntu@203.0.113.5" in cmd


def test_remote_path_is_shell_quoted():
    # a path with a space must not break the remote shell command
    cmd = build_fetch_command(
        ip="203.0.113.5", identity=None,
        remote_path="/tmp/a b.png", ssh_user="root",
    )
    assert "'/tmp/a b.png'" in cmd[-1]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd slurm-rest-api/examples/cli && python3 -m pytest tests/test_fetch.py -q; cd ../../..`
Expected: FAIL — `ModuleNotFoundError: No module named 'slurm_client.fetch'`.

- [ ] **Step 3: Implement `build_fetch_command`**

Create `slurm-rest-api/examples/cli/slurm_client/fetch.py`:

```python
"""Retrieve a job's result file from the gpu-worker container.

slurmrestd does not serve job output files, so `slurm_cli.py fetch` uses
an SSH side channel: it resolves the server's IPv4 with `conoha server
ips`, then `ssh ... docker exec <gpu-worker> cat <remote_path>` and writes
the bytes to a local file. The gpu-worker container is located by its
compose service label (project-name-agnostic — same trick as
get-token.sh, see postmortem C4).
"""
from __future__ import annotations

import shlex
import subprocess
from typing import Optional


def build_fetch_command(
    *,
    ip: str,
    identity: Optional[str],
    remote_path: str,
    ssh_user: str = "root",
) -> list[str]:
    """Build the ssh argv that cats a result file from the gpu-worker.

    Returned argv runs `cat <remote_path>` inside whichever container
    carries the `com.docker.compose.service=gpu-worker` label. stdout is
    the raw file bytes — the caller redirects it to a local file.
    """
    remote_cmd = (
        "docker exec "
        "$(docker ps -qf label=com.docker.compose.service=gpu-worker | head -1) "
        f"cat {shlex.quote(remote_path)}"
    )
    cmd = ["ssh"]
    if identity:
        cmd += ["-i", identity]
    cmd += [
        "-o", "StrictHostKeyChecking=accept-new",
        f"{ssh_user}@{ip}",
        remote_cmd,
    ]
    return cmd


def resolve_server_ip(server: str) -> str:
    """Resolve a conoha server name to its IPv4 via `conoha server ips`."""
    out = subprocess.run(
        ["conoha", "server", "ips", server],
        capture_output=True, text=True, check=True,
    ).stdout
    # lines look like:  ext-gpu-...: 203.0.113.5 (v4, fixed)
    for line in out.splitlines():
        if "(v4" in line and ":" in line:
            return line.split(":", 1)[1].strip().split()[0]
    raise RuntimeError(f"no IPv4 found for server {server!r} in:\n{out}")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd slurm-rest-api/examples/cli && python3 -m pytest tests/test_fetch.py -q; cd ../../..`
Expected: PASS — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add slurm-rest-api/examples/cli/slurm_client/fetch.py slurm-rest-api/examples/cli/tests/test_fetch.py
git commit -m "feat(slurm-rest-api): add build_fetch_command for the fetch CLI"
```

---

## Task 3: `fetch_result` + `slurm_cli.py fetch` subcommand

**Files:**
- Modify: `slurm-rest-api/examples/cli/slurm_client/fetch.py`
- Modify: `slurm-rest-api/examples/cli/slurm_cli.py`

- [ ] **Step 1: Add `fetch_result` to `fetch.py`**

Append to `slurm-rest-api/examples/cli/slurm_client/fetch.py`:

```python
def fetch_result(
    *,
    server: str,
    job_id: int,
    identity: Optional[str],
    output: str,
    remote_path: str,
    ssh_user: str = "root",
) -> None:
    """Resolve the server IP, ssh in, and write the remote file to `output`.

    Raises RuntimeError with an actionable message on the common failure
    modes (no container, file missing because the job is not a completed
    CFD workload, ssh failure).
    """
    ip = resolve_server_ip(server)
    cmd = build_fetch_command(
        ip=ip, identity=identity, remote_path=remote_path, ssh_user=ssh_user,
    )
    with open(output, "wb") as fh:
        proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        # ssh succeeded to the host but the remote command failed, or ssh
        # itself failed. Surface stderr verbatim plus a hint.
        import os
        if os.path.exists(output) and os.path.getsize(output) == 0:
            os.remove(output)
        stderr = proc.stderr.decode(errors="replace").strip()
        if "No such container" in stderr or "head -1" in stderr or not stderr:
            raise RuntimeError(
                f"no gpu-worker container running on {server!r}, or no "
                f"result file at {remote_path}. Is job {job_id} a completed "
                "CFD workload? (check `slurm_cli.py status {job_id}`)"
            )
        raise RuntimeError(f"fetch failed:\n{stderr}")
```

- [ ] **Step 2: Add the `fetch` click command to `slurm_cli.py`**

In `slurm-rest-api/examples/cli/slurm_cli.py`, add this import near the other `slurm_client` imports at the top:

```python
from slurm_client.fetch import fetch_result
```

Then add this command (place it after the existing `logs` command, before `if __name__ == "__main__":`):

```python
@cli.command()
@click.argument("job_id", type=int)
@click.option("--server", required=True,
              help="conoha server name (used to resolve the VM's IPv4)")
@click.option("--identity", default=None,
              help="SSH private key path (default: ssh's own default)")
@click.option("--ssh-user", default="root", show_default=True,
              help="SSH user on the VM")
@click.option("-o", "--output", default=None,
              help="local output path (default: ./slurm-<job_id>.png)")
@click.option("--remote-path", default=None,
              help="path inside the gpu-worker container "
                   "(default: /tmp/slurm-<job_id>.png)")
def fetch(job_id, server, identity, ssh_user, output, remote_path):
    """Fetch a job's result file (e.g. a CFD plot) from the gpu-worker.

    slurmrestd cannot serve job output files, so this SSHes to the VM and
    `docker exec ... cat`s the file out of the gpu-worker container.
    """
    remote_path = remote_path or f"/tmp/slurm-{job_id}.png"
    output = output or f"slurm-{job_id}.png"
    try:
        fetch_result(
            server=server, job_id=job_id, identity=identity,
            output=output, remote_path=remote_path, ssh_user=ssh_user,
        )
    except (RuntimeError, FileNotFoundError) as e:
        click.echo(f"error: {e}", err=True)
        sys.exit(1)
    click.echo(f"fetched job {job_id} result -> {output}")
```

- [ ] **Step 3: Verify the CLI wiring**

Run: `cd slurm-rest-api/examples/cli && python3 slurm_cli.py fetch --help; cd ../../..`
Expected: prints the `fetch` command help with `--server`, `--identity`, `--ssh-user`, `-o/--output`, `--remote-path` options. No import errors.

- [ ] **Step 4: Run the full CLI test suite (no regressions)**

Run: `cd slurm-rest-api/examples/cli && python3 -m pytest tests/ -q; cd ../../..`
Expected: PASS — all tests (the existing ones plus the 5 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add slurm-rest-api/examples/cli/slurm_client/fetch.py slurm-rest-api/examples/cli/slurm_cli.py
git commit -m "feat(slurm-rest-api): add slurm_cli.py fetch subcommand"
```

---

## Task 4: `cfd_sod_shock.py` — Sod shock tube

**Files:**
- Create: `slurm-rest-api/examples/workloads/cfd_sod_shock.py`

- [ ] **Step 1: Ensure torch + matplotlib are available locally for the self-check**

The CFD scripts are verified by running them on CPU at tiny resolution. Install the CPU deps once (skip if already present):

Run: `python3 -c "import torch, matplotlib, numpy" 2>/dev/null && echo "deps OK" || pip install --break-system-packages torch matplotlib numpy`
Expected: either "deps OK" or a successful install (torch CPU wheel ~200 MB).

- [ ] **Step 2: Create the Sod shock tube solver**

Create `slurm-rest-api/examples/workloads/cfd_sod_shock.py`:

```python
"""Sod shock tube — 1D compressible Euler, finite-volume HLL flux.

Submit with:
    slurm_cli.py submit cfd_sod_shock.py --partition gpu --gres gpu:1 \
        --cpus 2 --mem 2048 --time 5 --inline

Solves the classic Sod (1978) Riemann problem to t=0.2 and overlays the
exact Riemann solution. Writes density/velocity/pressure profiles to a
PNG and prints the measured shock position next to the analytic value.

Tunables (env vars): CELLS (default 2000), TEND (0.2), CFL (0.9).
"""
import os
import time

import numpy as np
import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

GAMMA = 1.4
device = "cuda" if torch.cuda.is_available() else "cpu"

CELLS = int(os.environ.get("CELLS", "2000"))
TEND = float(os.environ.get("TEND", "0.2"))
CFL = float(os.environ.get("CFL", "0.9"))

job_id = os.environ.get("SLURM_JOB_ID")
png_path = f"/tmp/slurm-{job_id}.png" if job_id else "cfd-sod-shock.png"

print(f"cfd_sod_shock: device={device} cells={CELLS} tend={TEND}")

dx = 1.0 / CELLS
x = torch.linspace(0.5 * dx, 1.0 - 0.5 * dx, CELLS, device=device, dtype=torch.float32)

# Sod initial condition: discontinuity at x=0.5.
#   left  (rho,u,p) = (1.0,   0, 1.0)
#   right (rho,u,p) = (0.125, 0, 0.1)
rho = torch.where(x < 0.5, torch.full_like(x, 1.0), torch.full_like(x, 0.125))
u = torch.zeros_like(x)
p = torch.where(x < 0.5, torch.full_like(x, 1.0), torch.full_like(x, 0.1))


def to_conserved(rho, u, p):
    E = p / (GAMMA - 1.0) + 0.5 * rho * u * u
    return torch.stack([rho, rho * u, E])


def to_primitive(U):
    rho = U[0].clamp_min(1e-9)
    u = U[1] / rho
    p = ((GAMMA - 1.0) * (U[2] - 0.5 * rho * u * u)).clamp_min(1e-9)
    return rho, u, p


def physical_flux(U):
    rho, u, p = to_primitive(U)
    return torch.stack([rho * u, rho * u * u + p, u * (U[2] + p)])


def hll_flux(UL, UR):
    rhoL, uL, pL = to_primitive(UL)
    rhoR, uR, pR = to_primitive(UR)
    aL = torch.sqrt(GAMMA * pL / rhoL)
    aR = torch.sqrt(GAMMA * pR / rhoR)
    # Davis wave-speed estimates.
    SL = torch.minimum(uL - aL, uR - aR)
    SR = torch.maximum(uL + aL, uR + aR)
    FL = physical_flux(UL)
    FR = physical_flux(UR)
    F_hll = (SR * FL - SL * FR + SL * SR * (UR - UL)) / (SR - SL)
    F = torch.where(SL >= 0, FL, torch.where(SR <= 0, FR, F_hll))
    return F


U = to_conserved(rho, u, p)
t = 0.0
step = 0
t0 = time.perf_counter()
while t < TEND:
    rho, u, p = to_primitive(U)
    a = torch.sqrt(GAMMA * p / rho)
    smax = float((u.abs() + a).max())
    dt = CFL * dx / smax
    if t + dt > TEND:
        dt = TEND - t
    # Interface fluxes between the CELLS cells (CELLS-1 interior interfaces).
    F = hll_flux(U[:, :-1], U[:, 1:])  # shape [3, CELLS-1]
    # Update interior cells; transmissive (zero-gradient) boundaries.
    U[:, 1:-1] = U[:, 1:-1] - dt / dx * (F[:, 1:] - F[:, :-1])
    U[:, 0] = U[:, 1]
    U[:, -1] = U[:, -2]
    if not torch.isfinite(U).all():
        print(f"divergence detected at step {step} — reduce CFL")
        raise SystemExit(1)
    t += dt
    step += 1
elapsed = time.perf_counter() - t0

rho, u, p = to_primitive(U)
rho_n = rho.cpu().numpy()
u_n = u.cpu().numpy()
p_n = p.cpu().numpy()
x_n = x.cpu().numpy()


# --- exact Riemann solution (Toro, ch. 4) for the overlay & reference -----
def exact_sod(x_arr, t_end):
    g = GAMMA
    rhoL, uL, pL = 1.0, 0.0, 1.0
    rhoR, uR, pR = 0.125, 0.0, 0.1
    aL = np.sqrt(g * pL / rhoL)
    aR = np.sqrt(g * pR / rhoR)

    def fK(p, pK, rhoK, aK):
        if p > pK:  # shock
            A = 2.0 / ((g + 1.0) * rhoK)
            B = (g - 1.0) / (g + 1.0) * pK
            return (p - pK) * np.sqrt(A / (p + B))
        else:       # rarefaction
            return 2.0 * aK / (g - 1.0) * ((p / pK) ** ((g - 1.0) / (2.0 * g)) - 1.0)

    def fK_prime(p, pK, rhoK, aK):
        if p > pK:
            A = 2.0 / ((g + 1.0) * rhoK)
            B = (g - 1.0) / (g + 1.0) * pK
            return np.sqrt(A / (B + p)) * (1.0 - (p - pK) / (2.0 * (B + p)))
        else:
            return (1.0 / (rhoK * aK)) * (p / pK) ** (-(g + 1.0) / (2.0 * g))

    p_star = 0.5 * (pL + pR)
    for _ in range(100):
        f = fK(p_star, pL, rhoL, aL) + fK(p_star, pR, rhoR, aR) + (uR - uL)
        fp = fK_prime(p_star, pL, rhoL, aL) + fK_prime(p_star, pR, rhoR, aR)
        dp = f / fp
        p_star -= dp
        if abs(dp) < 1e-12:
            break
    p_star = max(p_star, 1e-9)
    u_star = 0.5 * (uL + uR) + 0.5 * (fK(p_star, pR, rhoR, aR) - fK(p_star, pL, rhoL, aL))

    rho = np.empty_like(x_arr)
    vel = np.empty_like(x_arr)
    pre = np.empty_like(x_arr)
    for i, xi in enumerate(x_arr):
        s = (xi - 0.5) / t_end  # self-similar coordinate
        if s <= u_star:  # left of contact
            if p_star > pL:  # left shock
                rho_starL = rhoL * ((p_star / pL + (g - 1) / (g + 1)) /
                                    ((g - 1) / (g + 1) * p_star / pL + 1))
                SL = uL - aL * np.sqrt((g + 1) / (2 * g) * p_star / pL +
                                       (g - 1) / (2 * g))
                if s <= SL:
                    rho[i], vel[i], pre[i] = rhoL, uL, pL
                else:
                    rho[i], vel[i], pre[i] = rho_starL, u_star, p_star
            else:  # left rarefaction
                rho_starL = rhoL * (p_star / pL) ** (1.0 / g)
                a_starL = aL * (p_star / pL) ** ((g - 1) / (2 * g))
                SHL = uL - aL
                STL = u_star - a_starL
                if s <= SHL:
                    rho[i], vel[i], pre[i] = rhoL, uL, pL
                elif s >= STL:
                    rho[i], vel[i], pre[i] = rho_starL, u_star, p_star
                else:  # inside the fan
                    vel[i] = 2.0 / (g + 1) * (aL + (g - 1) / 2 * uL + s)
                    c = 2.0 / (g + 1) * (aL + (g - 1) / 2 * (uL - s))
                    rho[i] = rhoL * (c / aL) ** (2.0 / (g - 1))
                    pre[i] = pL * (c / aL) ** (2.0 * g / (g - 1))
        else:  # right of contact
            if p_star > pR:  # right shock
                rho_starR = rhoR * ((p_star / pR + (g - 1) / (g + 1)) /
                                    ((g - 1) / (g + 1) * p_star / pR + 1))
                SR = uR + aR * np.sqrt((g + 1) / (2 * g) * p_star / pR +
                                       (g - 1) / (2 * g))
                if s >= SR:
                    rho[i], vel[i], pre[i] = rhoR, uR, pR
                else:
                    rho[i], vel[i], pre[i] = rho_starR, u_star, p_star
            else:  # right rarefaction
                rho_starR = rhoR * (p_star / pR) ** (1.0 / g)
                a_starR = aR * (p_star / pR) ** ((g - 1) / (2 * g))
                SHR = uR + aR
                STR = u_star + a_starR
                if s >= SHR:
                    rho[i], vel[i], pre[i] = rhoR, uR, pR
                elif s <= STR:
                    rho[i], vel[i], pre[i] = rho_starR, u_star, p_star
                else:
                    vel[i] = 2.0 / (g + 1) * (-aR + (g - 1) / 2 * uR + s)
                    c = 2.0 / (g + 1) * (aR - (g - 1) / 2 * (uR - s))
                    rho[i] = rhoR * (c / aR) ** (2.0 / (g - 1))
                    pre[i] = pR * (c / aR) ** (2.0 * g / (g - 1))
    # Shock position: right-going shock front.
    if p_star > pR:
        SR = uR + aR * np.sqrt((g + 1) / (2 * g) * p_star / pR + (g - 1) / (2 * g))
        shock_x = 0.5 + SR * t_end
    else:
        shock_x = 0.5 + (uR + aR) * t_end
    return rho, vel, pre, shock_x


rho_e, u_e, p_e, shock_exact = exact_sod(x_n, TEND)

# Measured shock position: steepest density gradient in the right half.
right = x_n > 0.5
grad = np.abs(np.gradient(rho_n, x_n))
grad[~right] = 0.0
shock_measured = float(x_n[int(np.argmax(grad))])

print(f"steps={step} elapsed={elapsed:.2f}s")
print(f"observed: shock position x={shock_measured:.3f}")
print(f"reference (exact Riemann solution): x={shock_exact:.3f}")

fig, axes = plt.subplots(3, 1, figsize=(8, 9), sharex=True)
for ax, num, exa, label in [
    (axes[0], rho_n, rho_e, "density"),
    (axes[1], u_n, u_e, "velocity"),
    (axes[2], p_n, p_e, "pressure"),
]:
    ax.plot(x_n, num, "b-", lw=1.2, label="HLL (numerical)")
    ax.plot(x_n, exa, "r--", lw=1.0, label="exact Riemann")
    ax.set_ylabel(label)
    ax.legend(loc="best", fontsize=8)
    ax.grid(alpha=0.3)
axes[2].set_xlabel("x")
axes[0].set_title(f"Sod shock tube, t={TEND}  (cells={CELLS}, {device})")
fig.tight_layout()
fig.savefig(png_path, dpi=110)
print(f"wrote {png_path}")
```

- [ ] **Step 3: Run the local CPU self-check**

Run: `cd slurm-rest-api/examples/workloads && CELLS=400 python3 cfd_sod_shock.py; cd ../../..`
Expected: prints `device=cpu cells=400 ...`, an observed shock position and a reference shock position that agree to ~0.01–0.02 (both near x≈0.85), `wrote cfd-sod-shock.png`, exit 0. A file `slurm-rest-api/examples/workloads/cfd-sod-shock.png` exists. If the observed and reference shock positions disagree by more than ~0.05, the HLL update or the exact solver has a bug — debug before committing.

- [ ] **Step 4: Remove the self-check artifact and commit**

```bash
rm -f slurm-rest-api/examples/workloads/cfd-sod-shock.png
git add slurm-rest-api/examples/workloads/cfd_sod_shock.py
git commit -m "feat(slurm-rest-api): add cfd_sod_shock workload (1D Euler, HLL)"
```

---

## Task 5: `cfd_lid_cavity.py` — lid-driven cavity

**Files:**
- Create: `slurm-rest-api/examples/workloads/cfd_lid_cavity.py`

- [ ] **Step 1: Create the lid-driven cavity solver**

Create `slurm-rest-api/examples/workloads/cfd_lid_cavity.py`:

```python
"""Lid-driven cavity — incompressible Navier-Stokes, vorticity-streamfunction.

Submit with:
    slurm_cli.py submit cfd_lid_cavity.py --partition gpu --gres gpu:1 \
        --cpus 2 --mem 4096 --time 8 --inline

Marches the vorticity transport equation to steady state on a unit square
with the top lid moving at u=1. The streamfunction Poisson equation is
solved each step by Jacobi iteration (fully parallel — no sequential SOR
sweep). Writes streamfunction contours to a PNG and prints the minimum
u-velocity on the vertical centerline next to the Ghia et al. (1982)
reference.

Array layout: f[i, j] maps to (x_i, y_j). The lid is the j = -1 edge.
Tunables (env vars): GRID (default 256), RE (100), STEPS (60000),
POISSON_ITERS (60).
"""
import os
import time

import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

device = "cuda" if torch.cuda.is_available() else "cpu"

N = int(os.environ.get("GRID", "256"))
RE = float(os.environ.get("RE", "100"))
STEPS = int(os.environ.get("STEPS", "60000"))
POISSON_ITERS = int(os.environ.get("POISSON_ITERS", "60"))

job_id = os.environ.get("SLURM_JOB_ID")
png_path = f"/tmp/slurm-{job_id}.png" if job_id else "cfd-lid-cavity.png"

print(f"cfd_lid_cavity: device={device} grid={N}x{N} Re={RE} steps={STEPS}")

h = 1.0 / (N - 1)
U_LID = 1.0
# Conservative explicit dt: limited by diffusion (h^2 * Re / 4) and a CFL-like
# advection bound (h / U_LID). The 0.2 factor keeps a comfortable margin.
dt = 0.2 * min(h * h * RE / 4.0, h / U_LID)

psi = torch.zeros(N, N, device=device, dtype=torch.float32)
w = torch.zeros(N, N, device=device, dtype=torch.float32)

t0 = time.perf_counter()
for step in range(STEPS):
    # 1. Streamfunction Poisson: laplacian(psi) = -w, psi = 0 on all walls.
    #    Jacobi iteration; only interior nodes are updated so the zero
    #    Dirichlet boundary is preserved automatically.
    for _ in range(POISSON_ITERS):
        psi[1:-1, 1:-1] = 0.25 * (
            psi[2:, 1:-1] + psi[:-2, 1:-1]
            + psi[1:-1, 2:] + psi[1:-1, :-2]
            + h * h * w[1:-1, 1:-1]
        )

    # 2. Velocities from the streamfunction: u = d(psi)/dy, v = -d(psi)/dx.
    u = torch.zeros_like(psi)
    v = torch.zeros_like(psi)
    u[1:-1, 1:-1] = (psi[1:-1, 2:] - psi[1:-1, :-2]) / (2.0 * h)
    v[1:-1, 1:-1] = -(psi[2:, 1:-1] - psi[:-2, 1:-1]) / (2.0 * h)

    # 3. Wall vorticity (Thom's formula). psi = 0 on every wall.
    w[0, :] = -2.0 * psi[1, :] / (h * h)              # left   wall x=0
    w[-1, :] = -2.0 * psi[-2, :] / (h * h)            # right  wall x=1
    w[:, 0] = -2.0 * psi[:, 1] / (h * h)              # bottom wall y=0
    w[:, -1] = -2.0 * psi[:, -2] / (h * h) - 2.0 * U_LID / h  # moving lid y=1

    # 4. Vorticity transport: dw/dt = -u dw/dx - v dw/dy + (1/Re) lap(w).
    dwdx = torch.zeros_like(w)
    dwdy = torch.zeros_like(w)
    dwdx[1:-1, 1:-1] = (w[2:, 1:-1] - w[:-2, 1:-1]) / (2.0 * h)
    dwdy[1:-1, 1:-1] = (w[1:-1, 2:] - w[1:-1, :-2]) / (2.0 * h)
    lap_w = torch.zeros_like(w)
    lap_w[1:-1, 1:-1] = (
        w[2:, 1:-1] + w[:-2, 1:-1] + w[1:-1, 2:] + w[1:-1, :-2]
        - 4.0 * w[1:-1, 1:-1]
    ) / (h * h)
    rhs = -u * dwdx - v * dwdy + (1.0 / RE) * lap_w
    w[1:-1, 1:-1] = w[1:-1, 1:-1] + dt * rhs[1:-1, 1:-1]

    if not torch.isfinite(w).all():
        print(f"divergence detected at step {step} — reduce dt or Re")
        raise SystemExit(1)

elapsed = time.perf_counter() - t0

# Final velocity field for the observable.
u = torch.zeros_like(psi)
u[1:-1, 1:-1] = (psi[1:-1, 2:] - psi[1:-1, :-2]) / (2.0 * h)
centerline_u = u[N // 2, :].cpu().numpy()
min_u = float(centerline_u.min())

print(f"elapsed={elapsed:.2f}s dt={dt:.2e}")
print(f"observed: min u on vertical centerline = {min_u:.3f}")
print("reference (Ghia et al. 1982, Re=100): min u ~ -0.21")

psi_n = psi.cpu().numpy().T  # transpose so imshow/contour shows x horizontal
fig, ax = plt.subplots(figsize=(6.5, 6))
xs = torch.linspace(0, 1, N).numpy()
cs = ax.contour(xs, xs, psi_n, levels=25, cmap="viridis")
ax.set_aspect("equal")
ax.set_xlabel("x")
ax.set_ylabel("y")
ax.set_title(f"Lid-driven cavity, Re={RE}  (grid={N}x{N}, {device})")
fig.colorbar(cs, ax=ax, label="streamfunction")
fig.tight_layout()
fig.savefig(png_path, dpi=110)
print(f"wrote {png_path}")
```

- [ ] **Step 2: Run the local CPU self-check**

Run: `cd slurm-rest-api/examples/workloads && GRID=64 STEPS=8000 python3 cfd_lid_cavity.py; cd ../../..`
Expected: prints `device=cpu grid=64x64 ...`, runs without `divergence detected`, prints an observed min-u that is negative and in the rough ballpark of the -0.21 reference (a coarse 64-grid short run will not match exactly — anywhere in roughly -0.12 to -0.22 confirms the scheme is qualitatively right), `wrote cfd-lid-cavity.png`, exit 0. If it diverges or min-u is positive / near zero, the wall-vorticity or transport step has a sign bug — debug before committing.

- [ ] **Step 3: Remove the self-check artifact and commit**

```bash
rm -f slurm-rest-api/examples/workloads/cfd-lid-cavity.png
git add slurm-rest-api/examples/workloads/cfd_lid_cavity.py
git commit -m "feat(slurm-rest-api): add cfd_lid_cavity workload (NS, vorticity-streamfunction)"
```

---

## Task 6: `cfd_lbm_cylinder.py` — flow past a cylinder (LBM)

**Files:**
- Create: `slurm-rest-api/examples/workloads/cfd_lbm_cylinder.py`

- [ ] **Step 1: Create the LBM cylinder solver**

Create `slurm-rest-api/examples/workloads/cfd_lbm_cylinder.py`:

```python
"""Flow past a cylinder — D2Q9 lattice-Boltzmann (BGK), von Karman street.

Submit with:
    slurm_cli.py submit cfd_lbm_cylinder.py --partition gpu --gres gpu:1 \
        --cpus 2 --mem 4096 --time 10 --inline

A torch port of the well-known Latt lattice-Boltzmann cylinder example.
Streaming is torch.roll, collision is elementwise — all GPU-friendly
tensor ops. A velocity probe in the wake is FFT'd to estimate the vortex
shedding frequency and the Strouhal number.

Tunables (env vars): GRID_X (default 520), GRID_Y (180), RE (150),
STEPS (60000).
"""
import math
import os
import time

import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

device = "cuda" if torch.cuda.is_available() else "cpu"
dtype = torch.float32

nx = int(os.environ.get("GRID_X", "520"))
ny = int(os.environ.get("GRID_Y", "180"))
Re = float(os.environ.get("RE", "150"))
nsteps = int(os.environ.get("STEPS", "60000"))

job_id = os.environ.get("SLURM_JOB_ID")
png_path = f"/tmp/slurm-{job_id}.png" if job_id else "cfd-lbm-cylinder.png"

print(f"cfd_lbm_cylinder: device={device} grid={nx}x{ny} Re={Re} steps={nsteps}")

ly = ny - 1
cx, cy, r = nx // 4, ny // 2, ny // 9
uLB = 0.04                                  # inlet velocity (lattice units)
nulb = uLB * r / Re                         # kinematic viscosity (lattice units)
omega = 1.0 / (3.0 * nulb + 0.5)            # BGK relaxation parameter

# D2Q9 lattice (Latt ordering: index i and 8-i are opposite directions).
v = torch.tensor(
    [[1, 1], [1, 0], [1, -1], [0, 1], [0, 0], [0, -1], [-1, 1], [-1, 0], [-1, -1]],
    device=device, dtype=dtype,
)
w = torch.tensor(
    [1/36, 1/9, 1/36, 1/9, 4/9, 1/9, 1/36, 1/9, 1/36],
    device=device, dtype=dtype,
)
col_left = [0, 1, 2]   # v_x = +1
col_mid = [3, 4, 5]    # v_x =  0
col_right = [6, 7, 8]  # v_x = -1

# Cylinder mask.
xx = torch.arange(nx, device=device).view(nx, 1)
yy = torch.arange(ny, device=device).view(1, ny)
obstacle = ((xx - cx) ** 2 + (yy - cy) ** 2) < (r * r)

# Inlet velocity with a tiny y-dependent perturbation to break symmetry and
# trigger shedding.
y_idx = torch.arange(ny, device=device, dtype=dtype)
vel = torch.zeros(2, nx, ny, device=device, dtype=dtype)
vel[0] = (uLB * (1.0 + 1e-4 * torch.sin(y_idx / ly * 2.0 * math.pi))).view(1, ny)


def equilibrium(rho, u):
    # rho: [nx,ny]  u: [2,nx,ny]  ->  feq: [9,nx,ny]
    cu = 3.0 * torch.einsum("id,dxy->ixy", v, u)
    usqr = 1.5 * (u[0] ** 2 + u[1] ** 2)
    return rho.unsqueeze(0) * w.view(9, 1, 1) * (
        1.0 + cu + 0.5 * cu ** 2 - usqr.unsqueeze(0)
    )


# Initial condition: equilibrium at the inlet velocity everywhere.
rho0 = torch.ones(nx, ny, device=device, dtype=dtype)
fin = equilibrium(rho0, vel)

probe_x, probe_y = cx + 6 * r, cy   # wake probe for the Strouhal estimate
probe = torch.zeros(nsteps, device=device, dtype=dtype)

t0 = time.perf_counter()
for step in range(nsteps):
    # Outflow on the right wall (zero-gradient for the leftward populations).
    fin[col_right, -1, :] = fin[col_right, -2, :]

    # Macroscopic moments.
    rho = fin.sum(0)
    u = torch.einsum("id,ixy->dxy", v, fin) / rho

    # Zou/He velocity inlet on the left wall.
    u[:, 0, :] = vel[:, 0, :]
    rho[0, :] = (1.0 / (1.0 - u[0, 0, :])) * (
        fin[col_mid, 0, :].sum(0) + 2.0 * fin[col_right, 0, :].sum(0)
    )

    feq = equilibrium(rho, u)
    fin[col_left, 0, :] = feq[col_left, 0, :] + fin[col_right, 0, :] - feq[col_right, 0, :]

    # BGK collision.
    fout = fin - omega * (fin - feq)

    # Bounce-back inside the cylinder.
    for i in range(9):
        fout[i, obstacle] = fin[8 - i, obstacle]

    # Streaming.
    for i in range(9):
        fin[i] = torch.roll(
            torch.roll(fout[i], int(v[i, 0].item()), dims=0),
            int(v[i, 1].item()), dims=1,
        )

    probe[step] = u[1, probe_x, probe_y]

    if not torch.isfinite(fin).all():
        print(f"divergence detected at step {step} — reduce Re or uLB")
        raise SystemExit(1)

elapsed = time.perf_counter() - t0

# Strouhal number from the wake probe: drop the initial transient, FFT the
# transverse velocity, take the dominant non-DC frequency.
series = probe[nsteps // 3:].cpu()
series = series - series.mean()
spec = torch.fft.rfft(series)
freqs = torch.fft.rfftfreq(series.numel())  # cycles per step
mag = spec.abs()
mag[0] = 0.0
peak = int(torch.argmax(mag))
f_peak = float(freqs[peak])                 # 1 / step
strouhal = f_peak * (2.0 * r) / uLB

print(f"elapsed={elapsed:.2f}s omega={omega:.3f}")
print(f"observed: Strouhal number St = {strouhal:.3f}")
print("reference (Re~100-200): St ~ 0.16-0.18")

# Vorticity field for the PNG.
rho = fin.sum(0)
u = torch.einsum("id,ixy->dxy", v, fin) / rho
ux, uy = u[0], u[1]
vort = torch.zeros(nx, ny, device=device, dtype=dtype)
vort[1:-1, 1:-1] = (
    (uy[2:, 1:-1] - uy[:-2, 1:-1]) - (ux[1:-1, 2:] - ux[1:-1, :-2])
) * 0.5
vort_n = vort.cpu().numpy().T
vort_n_masked = vort_n.copy()
obs_n = obstacle.cpu().numpy().T
vort_n_masked[obs_n] = 0.0

fig, ax = plt.subplots(figsize=(11, 4))
lim = float(abs(vort_n_masked).max()) * 0.6 + 1e-9
im = ax.imshow(vort_n_masked, origin="lower", cmap="RdBu_r",
               vmin=-lim, vmax=lim, aspect="equal")
ax.set_title(f"Flow past cylinder, Re={Re}  (vorticity, {nx}x{ny}, {device})")
ax.set_xlabel("x")
ax.set_ylabel("y")
fig.colorbar(im, ax=ax, label="vorticity", shrink=0.8)
fig.tight_layout()
fig.savefig(png_path, dpi=110)
print(f"wrote {png_path}")
```

- [ ] **Step 2: Run the local CPU self-check**

Run: `cd slurm-rest-api/examples/workloads && GRID_X=160 GRID_Y=60 STEPS=3000 python3 cfd_lbm_cylinder.py; cd ../../..`
Expected: prints `device=cpu grid=160x60 ...`, runs without `divergence detected`, prints a Strouhal number (a 3000-step coarse run will give a rough/noisy value — any finite positive number without divergence confirms the LBM loop runs), `wrote cfd-lbm-cylinder.png`, exit 0. The literature-range match is verified properly at full resolution on L4 in Task 9. If it diverges, `uLB`/`omega` or the Zou-He inlet has a bug.

- [ ] **Step 3: Remove the self-check artifact and commit**

```bash
rm -f slurm-rest-api/examples/workloads/cfd-lbm-cylinder.png
git add slurm-rest-api/examples/workloads/cfd_lbm_cylinder.py
git commit -m "feat(slurm-rest-api): add cfd_lbm_cylinder workload (D2Q9 LBM)"
```

---

## Task 7: `cfd_rayleigh_benard.py` — Rayleigh-Bénard convection

**Files:**
- Create: `slurm-rest-api/examples/workloads/cfd_rayleigh_benard.py`

- [ ] **Step 1: Create the Rayleigh-Bénard solver**

Create `slurm-rest-api/examples/workloads/cfd_rayleigh_benard.py`:

```python
"""Rayleigh-Benard convection — 2D Boussinesq, vorticity-streamfunction + T.

Submit with:
    slurm_cli.py submit cfd_rayleigh_benard.py --partition gpu --gres gpu:1 \
        --cpus 2 --mem 4096 --time 10 --inline

A unit-height layer heated from below (T=1) and cooled from above (T=0),
periodic in x. Nondimensionalized with the layer height, the thermal
diffusion time, and the temperature difference, so the equations are:

    d(omega)/dt + (u.grad) omega = Pr * lap(omega) + Ra * Pr * dT/dx
    d(T)/dt     + (u.grad) T     = lap(T)
    lap(psi) = -omega,  u = d(psi)/dy,  v = -d(psi)/dx

The Nusselt number is reported as Nu = 1 + <v*T> (volume average), which
is the standard convective heat-transport enhancement in these units.

Array layout: f[i, j] maps to (x_i, y_j); y=0 is the hot bottom wall,
y=1 the cold top wall. x is periodic (torch.roll).
Tunables (env vars): GRID (default 256 -> 256x128), RA (1e5), PR (0.71),
STEPS (40000).
"""
import os
import time

import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

device = "cuda" if torch.cuda.is_available() else "cpu"

NX = int(os.environ.get("GRID", "256"))
NY = NX // 2
RA = float(os.environ.get("RA", "1e5"))
PR = float(os.environ.get("PR", "0.71"))
STEPS = int(os.environ.get("STEPS", "40000"))
POISSON_ITERS = int(os.environ.get("POISSON_ITERS", "60"))

job_id = os.environ.get("SLURM_JOB_ID")
png_path = f"/tmp/slurm-{job_id}.png" if job_id else "cfd-rayleigh-benard.png"

print(f"cfd_rayleigh_benard: device={device} grid={NX}x{NY} Ra={RA:g} Pr={PR}")

# Aspect ratio 2:1, so dx == dy with NY = NX/2 over a unit-height layer.
h = 1.0 / (NY - 1)
# Conservative explicit dt: thermal/viscous diffusion limit.
dt = 0.15 * h * h / max(PR, 1.0)

# Fields. x index is periodic, y index has walls at j=0 and j=-1.
psi = torch.zeros(NX, NY, device=device, dtype=torch.float32)
w = torch.zeros(NX, NY, device=device, dtype=torch.float32)
# Temperature: linear conduction profile (1 at bottom -> 0 at top) plus a
# small sinusoidal seed perturbation to trigger convection.
y = torch.linspace(0, 1, NY, device=device).view(1, NY)
x = torch.linspace(0, 2, NX, device=device).view(NX, 1)
T = (1.0 - y).expand(NX, NY).clone()
T += 0.01 * torch.sin(torch.pi * x / 2.0) * torch.sin(torch.pi * y)


def ddx(f):
    # periodic central difference in x
    return (torch.roll(f, -1, 0) - torch.roll(f, 1, 0)) / (2.0 * h)


def ddy(f):
    # central difference in y on the interior; one-sided not needed because
    # callers only use interior rows.
    d = torch.zeros_like(f)
    d[:, 1:-1] = (f[:, 2:] - f[:, :-2]) / (2.0 * h)
    return d


def laplacian(f):
    lap = torch.zeros_like(f)
    # periodic in x, interior in y
    lap[:, 1:-1] = (
        torch.roll(f, -1, 0)[:, 1:-1] + torch.roll(f, 1, 0)[:, 1:-1]
        + f[:, 2:] + f[:, :-2] - 4.0 * f[:, 1:-1]
    ) / (h * h)
    return lap


t0 = time.perf_counter()
for step in range(STEPS):
    # 1. Streamfunction Poisson: lap(psi) = -w, psi = 0 on top/bottom walls,
    #    periodic in x. Jacobi iteration on interior rows.
    for _ in range(POISSON_ITERS):
        psi[:, 1:-1] = 0.25 * (
            torch.roll(psi, -1, 0)[:, 1:-1] + torch.roll(psi, 1, 0)[:, 1:-1]
            + psi[:, 2:] + psi[:, :-2]
            + h * h * w[:, 1:-1]
        )

    # 2. Velocities.
    u = ddy(psi)        # u = d(psi)/dy
    vvel = -ddx(psi)    # v = -d(psi)/dx

    # 3. Wall vorticity (Thom), psi = 0 on both walls; no-slip.
    w[:, 0] = -2.0 * psi[:, 1] / (h * h)
    w[:, -1] = -2.0 * psi[:, -2] / (h * h)

    # 4. Vorticity transport with the buoyancy source.
    rhs_w = (
        -u * ddx(w) - vvel * ddy(w)
        + PR * laplacian(w)
        + RA * PR * ddx(T)
    )
    w[:, 1:-1] = w[:, 1:-1] + dt * rhs_w[:, 1:-1]

    # 5. Temperature transport.
    rhs_T = -u * ddx(T) - vvel * ddy(T) + laplacian(T)
    T[:, 1:-1] = T[:, 1:-1] + dt * rhs_T[:, 1:-1]
    # Fixed-temperature walls.
    T[:, 0] = 1.0
    T[:, -1] = 0.0

    if not torch.isfinite(w).all():
        print(f"divergence detected at step {step} — reduce dt or Ra")
        raise SystemExit(1)

elapsed = time.perf_counter() - t0

# Nusselt number: Nu = 1 + <v*T> over the whole domain.
u = ddy(psi)
vvel = -ddx(psi)
nu = 1.0 + float((vvel * T).mean())

print(f"elapsed={elapsed:.2f}s dt={dt:.2e} steps={STEPS}")
print(f"observed: Nusselt number Nu = {nu:.2f}")
print("reference: Ra=1e4 -> Nu~2.2,  Ra=1e5 -> Nu~3.9-4.3,  Ra_c~1708")

T_n = T.cpu().numpy().T   # transpose -> rows are y, cols are x
u_n = u.cpu().numpy().T
v_n = vvel.cpu().numpy().T
fig, ax = plt.subplots(figsize=(10, 5))
im = ax.imshow(T_n, origin="lower", cmap="inferno", aspect="equal",
               extent=[0, 2, 0, 1])
# sparse velocity quiver overlay
skip = max(NX // 32, 1)
xs = torch.linspace(0, 2, NX).numpy()[::skip]
ys = torch.linspace(0, 1, NY).numpy()[::skip]
ax.quiver(xs, ys, u_n[::skip, ::skip], v_n[::skip, ::skip],
          color="white", scale_units="xy")
ax.set_title(f"Rayleigh-Benard, Ra={RA:g} Pr={PR}  (Nu={nu:.2f}, {device})")
ax.set_xlabel("x")
ax.set_ylabel("y")
fig.colorbar(im, ax=ax, label="temperature", shrink=0.8)
fig.tight_layout()
fig.savefig(png_path, dpi=110)
print(f"wrote {png_path}")
```

- [ ] **Step 2: Run the local CPU self-check**

Run: `cd slurm-rest-api/examples/workloads && GRID=64 RA=1e4 STEPS=6000 python3 cfd_rayleigh_benard.py; cd ../../..`
Expected: prints `device=cpu grid=64x32 ...`, runs without `divergence detected`, prints a Nusselt number ≥ 1.0 (a coarse short run at Ra=1e4 may not fully reach the ~2.2 reference but should be clearly above 1.0 once convection starts; if it stays at exactly 1.00 the buoyancy term is not driving flow), `wrote cfd-rayleigh-benard.png`, exit 0. If it diverges, reduce the `dt` factor; if Nu stays 1.00, check the sign of the `RA * PR * ddx(T)` buoyancy term.

- [ ] **Step 3: Remove the self-check artifact and commit**

```bash
rm -f slurm-rest-api/examples/workloads/cfd-rayleigh-benard.png
git add slurm-rest-api/examples/workloads/cfd_rayleigh_benard.py
git commit -m "feat(slurm-rest-api): add cfd_rayleigh_benard workload (Boussinesq convection)"
```

---

## Task 8: Documentation — workloads README + main README

**Files:**
- Modify: `slurm-rest-api/examples/workloads/README.md`
- Modify: `slurm-rest-api/README.md`

- [ ] **Step 1: Read both READMEs to match their style**

Run: `cat slurm-rest-api/examples/workloads/README.md; echo "===="; sed -n '1,120p' slurm-rest-api/README.md`
Expected: see the existing workload sections (`numpy_matmul.py`, `hyperparam_sweep.py`, `torch_gpu_check.py`) and the main README's quick-start block. Match this heading style and tone.

- [ ] **Step 2: Append the 4 CFD sections to the workloads README**

Append to `slurm-rest-api/examples/workloads/README.md`:

```markdown
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
Env: `GRID` (256), `RE` (100), `STEPS` (60000), `POISSON_ITERS` (60).

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
Env: `GRID` (256, → 256×128), `RA` (1e5), `PR` (0.71), `STEPS` (40000).

### Local CPU self-check

Every CFD script runs on CPU too (it falls back when CUDA is absent), so
you can smoke-test before deploying — small grids finish in seconds:

```bash
CELLS=400                 python3 cfd_sod_shock.py
GRID=64 STEPS=8000        python3 cfd_lid_cavity.py
GRID_X=160 GRID_Y=60 STEPS=3000  python3 cfd_lbm_cylinder.py
GRID=64 RA=1e4 STEPS=6000 python3 cfd_rayleigh_benard.py
```

Each prints its device, the observed quantity, and writes a
`cfd-<name>.png` in the current directory (no `SLURM_JOB_ID` set).
```

- [ ] **Step 3: Add a CFD line to the main README quick start**

In `slurm-rest-api/README.md`, find the quick-start step that submits workloads (the block with `slurm_cli.py submit ../workloads/numpy_matmul.py ...`). Immediately after the existing GPU submit line(s), add:

```bash
# CFD: fluid-dynamics solvers on the L4, results fetched as PNG plots
./slurm_cli.py submit ../workloads/cfd_lbm_cylinder.py \
    --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 10 --inline
./slurm_cli.py fetch <JOB_ID> --server myserver --identity ~/.ssh/conoha_mykey
```

If the README has a section listing the workload examples, also add a
one-line mention there: "four CFD solvers (`cfd_*.py`) — see
`examples/workloads/README.md`."

- [ ] **Step 4: Commit**

```bash
git add slurm-rest-api/examples/workloads/README.md slurm-rest-api/README.md
git commit -m "docs(slurm-rest-api): document the 4 CFD workloads and fetch"
```

---

## Task 9: Real L4 validation

This is the postmortem-mandated gate: `docker compose up` / local self-checks
are NOT sufficient. The work is only validated once it runs through
`conoha app deploy` on a real L4 and every observable lands in its
literature range.

**Files:** none (validation only; produces the log pasted into the PR in Task 10).

- [ ] **Step 1: Create the L4 server and open ports**

```bash
conoha server create --name slurm-cfd --flavor g2l-t-c20m128g1-l4 \
    --image vmi-docker-29.2-ubuntu-24.04-amd64 --key-name <your-keypair> \
    --security-group default --wait --wait-timeout 8m --no-input -y
conoha server open-port slurm-cfd 22,80,443 -y
```

If `server create` fails with an in-stock error after carving a boot
volume, retry with `--volume <existing-vol-id>` (see the conoha-cli skill).
Note the IPv4 from `conoha server ips slurm-cfd`.

- [ ] **Step 2: Install the NVIDIA stack, fixing the known driver mismatch**

```bash
ssh-keygen -R <ip>   # clear any stale host key for a recycled IP
conoha gpu setup slurm-cfd --identity ~/.ssh/<your-key>
```

`conoha gpu setup` is expected to exit non-zero: it installs the 595
open-kernel driver but pins `nvidia-utils-535`, so its final `nvidia-smi`
fails with a "Driver/library version mismatch" (postmortem G4). Fix it:

```bash
ssh -i ~/.ssh/<your-key> root@<ip> \
  'DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-utils-595-server libnvidia-compute-595-server && nvidia-smi -L && docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi -L'
```

Expected: `nvidia-smi -L` and the docker GPU-passthrough check both list `GPU 0: NVIDIA L4`.

- [ ] **Step 3: Deploy the sample**

```bash
conoha proxy boot slurm-cfd --acme-email <you@example.com> --identity ~/.ssh/<your-key>
cd slurm-rest-api
sed -i 's|slurm.example.com|<ip-with-dashes>.sslip.io|' conoha.yml
cp .env.example .env
conoha app init   slurm-cfd --identity ~/.ssh/<your-key> --no-input
conoha app deploy slurm-cfd --identity ~/.ssh/<your-key> --no-input
cd ..
```

Expected: `Deploy complete. ... phase=live`. Then `ssh ... 'docker ps'`
shows all 7 services + `conoha-proxy`, with `gpu-worker` healthy and the
`entrypoint-gpu.sh` log line `wrote /etc/slurm/gres.conf with 1 GPU entries`.

> If sslip.io's Let's Encrypt cert is rate-limited (HTTP 429 in
> `docker logs conoha-proxy`), tunnel the slurm-edge host port instead:
> `ssh -fNL 6820:localhost:$(ssh ... 'docker port <slurm-edge> 6820 | cut -d: -f2') root@<ip>`
> and use `SLURM_API_ENDPOINT=http://localhost:6820`. The proxy `/healthz`
> path is unchanged by this PR, so the tunnel is an acceptable validation
> path — note it in the PR body.

- [ ] **Step 4: Bootstrap the token and confirm the cluster**

```bash
scp -i ~/.ssh/<your-key> slurm-rest-api/examples/get-token.sh root@<ip>:/tmp/get-token.sh
ssh -i ~/.ssh/<your-key> root@<ip> 'chmod +x /tmp/get-token.sh && /tmp/get-token.sh slurm 7200' > /tmp/cfd-token
cd slurm-rest-api/examples/cli
mkdir -p ~/.slurm-api
echo "http://localhost:6820" > ~/.slurm-api/endpoint   # or the https endpoint
cp /tmp/cfd-token ~/.slurm-api/token
./slurm_cli.py nodes
cd ../../..
```

Expected: `./slurm_cli.py nodes` shows `c1 ... IDLE` and `g1 ... IDLE gres=gpu:nvidia:1`.

- [ ] **Step 5: Submit the 4 CFD jobs**

```bash
cd slurm-rest-api/examples/cli
for s in cfd_sod_shock cfd_lid_cavity cfd_lbm_cylinder cfd_rayleigh_benard; do
  ./slurm_cli.py submit ../workloads/$s.py \
      --partition gpu --gres gpu:1 --cpus 2 --mem 4096 --time 12 --inline
done
cd ../../..
```

Expected: each prints `submitted job_id=N`. Note the 4 job IDs.

- [ ] **Step 6: Wait for completion and check the observables**

Poll `./slurm_cli.py status` until all 4 are `COMPLETED`. Then read each
job's stdout to confirm the observed quantity is in its literature range:

```bash
cd slurm-rest-api/examples/cli
for id in <id1> <id2> <id3> <id4>; do
  echo "=== job $id ==="
  ssh -i ~/.ssh/<your-key> root@<ip> \
    "docker exec \$(docker ps -qf label=com.docker.compose.service=gpu-worker | head -1) cat /tmp/slurm-$id.out"
done
cd ../../..
```

Expected, per the spec's literature ranges:
- `cfd_sod_shock`: observed shock x ≈ reference shock x (within ~0.01)
- `cfd_lid_cavity`: min centerline u ≈ -0.21 (Re=100)
- `cfd_lbm_cylinder`: Strouhal St ≈ 0.16–0.18
- `cfd_rayleigh_benard`: Nu ≈ 3.9–4.3 (Ra=1e5)

If an observable is out of range, the corresponding solver needs tuning
(grid / steps / dt) or has a physics bug — fix the script, redeploy the
accessory (`docker compose -p slurm-rest-api-accessories ... build/up`),
and re-submit before proceeding. This is expected iteration, not a plan
failure.

- [ ] **Step 7: Fetch the 4 PNGs with the new CLI command**

```bash
cd slurm-rest-api/examples/cli
for id in <id1> <id2> <id3> <id4>; do
  ./slurm_cli.py fetch $id --server slurm-cfd --identity ~/.ssh/<your-key> \
      -o /tmp/cfd-$id.png
done
file /tmp/cfd-*.png
cd ../../..
```

Expected: each prints `fetched job <id> result -> /tmp/cfd-<id>.png`, and
`file` reports each as a PNG image. This exercises the Task 3 `fetch`
command end-to-end.

- [ ] **Step 8: Confirm no regression in the existing smoke test**

```bash
cd slurm-rest-api
SLURM_API_ENDPOINT=http://localhost:6820 SLURM_API_TOKEN=$(cat /tmp/cfd-token) \
    SLURM_SMOKE_GPU=1 python3 tests/smoke_test.py
cd ..
```

Expected: 8/8 PASS.

- [ ] **Step 9: Save the validation log and tear down**

Save the `docker ps` output, the 4 job stdout blocks, the 4 `fetch` lines,
and the 8/8 smoke result into `/tmp/cfd-validation.log` (used in Task 10).
Then destroy the VPS — L4 is billed at several times the CPU flavors:

```bash
conoha server delete slurm-cfd --delete-boot-volume --yes
cd slurm-rest-api && git checkout conoha.yml && rm -f .env && cd ..
```

Expected: `Server ... removed. Boot volume ... deleted`. `git status` shows
`conoha.yml` reverted to `slurm.example.com` and no stray `.env`.

---

## Task 10: Open the PR

**Files:** none (PR only).

- [ ] **Step 1: Confirm the branch state**

```bash
git log --oneline feat/slurm-rest-api-gpu-worker..feat/slurm-rest-api-cfd-workloads
git status --short
```

Expected: the 8 implementation commits (Tasks 1–8) plus the spec/plan doc
commits; a clean working tree.

- [ ] **Step 2: Push and open the PR stacked on #103**

```bash
git push -u origin feat/slurm-rest-api-cfd-workloads
gh pr create --base feat/slurm-rest-api-gpu-worker \
  --title "feat(slurm-rest-api): add 4 CFD workload examples + fetch command" \
  --body "$(cat <<'EOF'
Adds four fluid-dynamics workload examples to the slurm-rest-api sample,
plus a `slurm_cli.py fetch` command to retrieve their result plots.

**Stacked on #103** (the gpu-worker accessory). Base branch is
`feat/slurm-rest-api-gpu-worker`; rebase onto main once #103 merges.

## Summary
- `examples/workloads/cfd_{lbm_cylinder,lid_cavity,sod_shock,rayleigh_benard}.py`
  — torch-on-GPU CFD solvers, submitted `--inline` to the gpu partition.
- `examples/cli/slurm_cli.py fetch` — SSH side-channel retrieval of a job's
  result PNG from the gpu-worker container (slurmrestd can't serve files).
- `Dockerfile` gpu stage gains `matplotlib`.
- Each workload prints an observed physical quantity vs its literature range.

## Real-L4 validation (conoha app deploy path)
<paste /tmp/cfd-validation.log here: docker ps, the 4 job stdout blocks
showing observables in literature range, the 4 fetch lines, 8/8 smoke>

VPS + boot volume deleted after validation.

## Test plan
- [x] CLI unit tests pass (incl. 5 new `build_fetch_command` tests)
- [x] each CFD script self-checks on CPU at small grid
- [x] L4: 4 CFD jobs COMPLETED, observables in literature range
- [x] L4: all 4 PNGs fetched via `slurm_cli.py fetch`
- [x] L4: existing smoke test still 8/8
EOF
)"
```

Expected: PR created against `feat/slurm-rest-api-gpu-worker`. Paste the
real validation log into the body (replace the placeholder block).

- [ ] **Step 3: Report the PR URL**

Output the PR URL for the user.

---

## Self-Review

**1. Spec coverage:**
- Spec §2 (4 workloads, all gpu/torch, PNG+fetch, observed-vs-literature) → Tasks 4–7 (one solver each), Task 1 (matplotlib), Tasks 2–3 (fetch). ✓
- Spec §3 file layout → Task 1 (Dockerfile), Tasks 2–3 (`fetch.py`, `slurm_cli.py`, `test_fetch.py`), Tasks 4–7 (4 `cfd_*.py`), Task 8 (both READMEs). ✓
- Spec §4 (4 solvers, methods, observables, literature ranges) → Tasks 4–7 with complete code; literature ranges checked in Task 9 Step 6. ✓
- Spec §5 (`fetch` command, options, mechanism, `build_fetch_command`/`fetch_result` split, error handling) → Tasks 2–3. ✓
- Spec §6 (matplotlib in gpu stage) → Task 1. ✓
- Spec §7 (workload error handling: Agg, device print, SLURM_JOB_ID fallback, divergence guard) → present in all 4 solver scripts in Tasks 4–7. ✓
- Spec §8 (3-stage testing: unit test, local CPU self-check, real L4) → Task 2 (unit), Tasks 4–7 Step "self-check", Task 9 (L4). smoke_test.py left unchanged, re-run in Task 9 Step 8. ✓
- Spec §10 Definition of Done → covered across Tasks 1–10; the PR-evidence item is Task 10 Step 2.

**2. Placeholder scan:** No "TBD"/"TODO". The PR body has one intentional `<paste ...>` block filled from the Task 9 log, and `<ip>` / `<your-key>` / `<id1>` placeholders in Task 9 are runtime values the executor substitutes — these are operator inputs, not unfinished plan content. All code blocks are complete and runnable.

**3. Type consistency:**
- `build_fetch_command(*, ip, identity, remote_path, ssh_user="root")` — defined in Task 2, called with the same keyword args by `fetch_result` in Task 3. ✓
- `fetch_result(*, server, job_id, identity, output, remote_path, ssh_user="root")` — defined in Task 3 Step 1, called with the same keyword args by the `fetch` click command in Task 3 Step 2. ✓
- `resolve_server_ip(server)` — defined in Task 2, used by `fetch_result` in Task 3. ✓
- PNG path convention `/tmp/slurm-$SLURM_JOB_ID.png` — written by all 4 solvers (Tasks 4–7), default `--remote-path` in the `fetch` command (Task 3), used in Task 9 Steps 6–7. Consistent. ✓
- Env var names (`CELLS`, `TEND`, `CFL`, `GRID`, `RE`, `STEPS`, `POISSON_ITERS`, `GRID_X`, `GRID_Y`, `RA`, `PR`) match between each solver script and its workloads-README section in Task 8. ✓
