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
if device == "cuda":
    torch.cuda.synchronize()
t0 = time.perf_counter()
with torch.no_grad():
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
if device == "cuda":
    torch.cuda.synchronize()
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
