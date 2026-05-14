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

if device == "cuda":
    torch.cuda.synchronize()
t0 = time.perf_counter()
with torch.no_grad():
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

if device == "cuda":
    torch.cuda.synchronize()
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

print(f"elapsed={elapsed:.2f}s omega={omega:.3f} steps={nsteps}")
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
