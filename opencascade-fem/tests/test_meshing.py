"""Tests for app.core.meshing — OCC → STEP → gmsh → MSH."""
from pathlib import Path

import meshio
import pytest

from app.core import shapes as S
from app.core import meshing as M


def test_mesh_plate_hole_writes_tet_msh_with_physical_groups(tmp_path: Path):
    shape, tags = S.build("plate_hole", S.defaults("plate_hole"))
    msh_path = M.mesh(shape, tags, mesh_size=10.0, work_dir=tmp_path)
    assert msh_path.exists()

    m = meshio.read(str(msh_path))
    # gmsh tet name
    tet_cells = [c for c in m.cells if c.type == "tetra"]
    assert tet_cells and tet_cells[0].data.shape[0] > 0
    # physical groups are exported as cell_sets named "fixed" and "load"
    assert "fixed" in m.cell_sets
    assert "load" in m.cell_sets
