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
Tunables (env vars): GRID (default 128 -> 128x64), RA (1e5), PR (0.71),
STEPS (20000), POISSON_ITERS (120). The Jacobi streamfunction solve
converges slowly with N — POISSON_ITERS and STEPS need to scale together
(roughly POISSON_ITERS ~ (N/64)^2) if you bump GRID significantly.
"""
import os
import time

import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

device = "cuda" if torch.cuda.is_available() else "cpu"

NX = int(os.environ.get("GRID", "128"))
NY = NX // 2
RA = float(os.environ.get("RA", "1e5"))
PR = float(os.environ.get("PR", "0.71"))
STEPS = int(os.environ.get("STEPS", "20000"))
POISSON_ITERS = int(os.environ.get("POISSON_ITERS", "120"))

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


if device == "cuda":
    torch.cuda.synchronize()
t0 = time.perf_counter()
with torch.no_grad():
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

if device == "cuda":
    torch.cuda.synchronize()
elapsed = time.perf_counter() - t0

# Nusselt number: Nu = 1 + <v*T> over the whole domain.
u = ddy(psi)
vvel = -ddx(psi)
nu = 1.0 + float((vvel * T).mean())

print(f"elapsed={elapsed:.2f}s dt={dt:.2e} steps={STEPS}")
print(f"observed: Nusselt number Nu = {nu:.2f}")
print("reference: Ra=1e4 -> Nu~2.2,  Ra=1e5 -> Nu~3.9-4.3,  Ra_c~1708")
# Boundary-layer scaling: BL ~ Ra^(-1/3). At Ra=1e5 that is ~0.022; the
# default GRID=128 gives h~0.016 so BL/h is only ~1.4 cells — Nu biased
# ~15% high. Raise GRID (and POISSON_ITERS, STEPS) for a literature match.
bl_thickness = RA ** (-1.0 / 3.0)
print(f"note: BL thickness ~ Ra^(-1/3) = {bl_thickness:.3f},  h = {h:.4f},  BL/h = {bl_thickness/h:.1f}")
print("  Nu is biased high when BL/h < ~3-4; convection cells in the PNG")
print("  are still qualitatively correct.")

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
