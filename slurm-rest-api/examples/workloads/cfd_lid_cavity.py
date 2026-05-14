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
Tunables (env vars): GRID (default 64), RE (100), STEPS (8000),
POISSON_ITERS (60). The defaults are the configuration validated against
the Ghia et al. (1982) Re=100 reference. Larger grids stress the GPU
more but the Jacobi streamfunction solve converges slowly with N — bump
POISSON_ITERS and STEPS together (roughly POISSON_ITERS ~ (N/64)^2 and
enough STEPS to reach t >= 12) or the printed min-u comparison will be
a transient, not the steady state.
"""
import os
import time

import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

device = "cuda" if torch.cuda.is_available() else "cpu"

N = int(os.environ.get("GRID", "64"))
RE = float(os.environ.get("RE", "100"))
STEPS = int(os.environ.get("STEPS", "8000"))
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

if device == "cuda":
    torch.cuda.synchronize()
t0 = time.perf_counter()
with torch.no_grad():
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
        #    (corner cells are written twice by adjacent walls — harmless,
        #     they are never read by the interior stencil.)
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

if device == "cuda":
    torch.cuda.synchronize()
elapsed = time.perf_counter() - t0

# Final velocity field for the observable.
u = torch.zeros_like(psi)
u[1:-1, 1:-1] = (psi[1:-1, 2:] - psi[1:-1, :-2]) / (2.0 * h)
centerline_u = u[N // 2, :].cpu().numpy()
min_u = float(centerline_u.min())

print(f"elapsed={elapsed:.2f}s dt={dt:.2e} steps={STEPS}")
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
