"""Serialize a solver Result + mesh to a single VTU file."""
from __future__ import annotations

from pathlib import Path

import meshio
import numpy as np


def write(result, mesh, path: Path) -> None:
    points = mesh.p.T
    cells = [("tetra", mesh.t.T)]
    point_data = {
        "displacement": result.displacement.astype(np.float32),
        "displacement_magnitude": np.linalg.norm(result.displacement, axis=1).astype(np.float32),
        "von_mises": result.von_mises.astype(np.float32),
    }
    meshio.write_points_cells(str(path), points, cells, point_data=point_data, file_format="vtu")
