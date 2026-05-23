"""Stress concentration around a hole in a plate under uniform tension (Kirsch).
Expected peak σ_vM near the hole ≈ 3 × nominal."""
from pathlib import Path

import numpy as np
import pytest

from app.core import shapes as S, meshing as M, solver as F


@pytest.mark.slow
def test_plate_hole_stress_concentration_factor_near_three(tmp_path: Path):
    params = {"length": 200.0, "width": 80.0, "thickness": 5.0, "hole_radius": 8.0}
    shape, tags = S.build("plate_hole", params)
    msh = M.mesh(shape, tags, mesh_size=3.0, work_dir=tmp_path)
    mat = F.Material(E_GPa=200.0, nu=0.3)
    P_MPa = 10.0

    result, mesh = F.solve(msh, mat, traction_MPa=P_MPa)

    # nominal far-field stress
    sigma_nominal = P_MPa

    # peak vM somewhere in the mesh
    sigma_peak = float(result.von_mises.max())
    K = sigma_peak / sigma_nominal

    # Kirsch infinite plate: K=3. Finite plate + coarse mesh + lumped lambda: ±35%.
    assert 1.8 <= K <= 4.5, f"expected Kirsch K ≈ 3, got {K:.2f}"
