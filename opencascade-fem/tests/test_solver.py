"""Analytical benchmark: axial stretch δ = P*L / E."""
from pathlib import Path

import numpy as np
import pytest

from app.core import shapes as S, meshing as M, solver as F


@pytest.mark.slow
def test_axial_stretch_matches_PL_over_E_within_5_percent(tmp_path: Path):
    # Solid plate (tiny hole keeps the gallery shape happy, doesn't perturb axial stretch).
    params = {"length": 200.0, "width": 40.0, "thickness": 5.0, "hole_radius": 1.0}
    shape, tags = S.build("plate_hole", params)
    msh = M.mesh(shape, tags, mesh_size=4.0, work_dir=tmp_path)
    mat = F.Material(E_GPa=200.0, nu=0.3)
    P_MPa = 1.0  # uniform traction of 1 MPa over the loaded face

    result, mesh = F.solve(msh, mat, traction_MPa=P_MPa)

    L = params["length"]
    E_MPa = mat.E_GPa * 1e3
    # σ = P, axial stretch δ = (σ/E)*L = (P/E)*L for tension-only rod.
    delta_analytic = (P_MPa / E_MPa) * L

    p = mesh.p.T
    # nodes on the loaded face (X = L)
    loaded = np.where(np.abs(p[:, 0] - L) < 0.1)[0]
    assert loaded.size > 0
    measured_ux = float(result.displacement[loaded, 0].mean())

    assert measured_ux == pytest.approx(delta_analytic, rel=0.05), (
        f"axial: analytic={delta_analytic:.4e} mm, measured={measured_ux:.4e} mm"
    )
