# opencascade-fem/app/core/vtu.py
"""Serialize the solver Result + mesh boundary as a single VTP (XML PolyData) file.

vtk.js (browser side) does NOT have an unstructured grid reader, only PolyData
readers. We extract the boundary surface of the tet mesh and write it as VTP,
carrying displacement and von_mises as point_data.

meshio 5.x does not support the 'vtp' format, so we write the XML directly.
VTP (VTK XML PolyData) is a straightforward ASCII or Base64 XML format.
"""
from __future__ import annotations

import base64
import struct
from pathlib import Path

import numpy as np


def _b64(arr: np.ndarray) -> str:
    """Encode a numpy array as VTK inline Base64 (length-prefixed: uint64 byte count + data)."""
    raw = arr.tobytes()
    header = struct.pack("<Q", len(raw))  # uint64 little-endian byte count
    return base64.b64encode(header + raw).decode("ascii")


def write(result, mesh, path: Path) -> None:
    points = mesh.p.T.astype(np.float32)          # (n_nodes, 3)
    boundary_idx = mesh.boundary_facets()
    polys = mesh.facets.T[boundary_idx].astype(np.int64)  # (n_tri, 3)

    n_pts = points.shape[0]
    n_polys = polys.shape[0]

    disp = result.displacement.astype(np.float32)  # (n_nodes, 3)
    disp_mag = np.linalg.norm(disp, axis=1).astype(np.float32)
    von_mises = result.von_mises.astype(np.float32)

    # VTK connectivity: for PolyData polys we need flat connectivity + offsets arrays
    connectivity = polys.flatten().astype(np.int64)         # (n_polys*3,)
    offsets = (np.arange(1, n_polys + 1) * 3).astype(np.int64)  # (n_polys,)

    lines = [
        '<?xml version="1.0"?>',
        '<VTKFile type="PolyData" version="0.1" byte_order="LittleEndian"'
        ' header_type="UInt64">',
        "  <PolyData>",
        f'    <Piece NumberOfPoints="{n_pts}" NumberOfPolys="{n_polys}">',
        '      <Points>',
        '        <DataArray type="Float32" NumberOfComponents="3"'
        ' format="binary">',
        f"          {_b64(points)}",
        "        </DataArray>",
        "      </Points>",
        "      <Polys>",
        '        <DataArray type="Int64" Name="connectivity" format="binary">',
        f"          {_b64(connectivity)}",
        "        </DataArray>",
        '        <DataArray type="Int64" Name="offsets" format="binary">',
        f"          {_b64(offsets)}",
        "        </DataArray>",
        "      </Polys>",
        '      <PointData Scalars="von_mises" Vectors="displacement">',
        '        <DataArray type="Float32" Name="displacement"'
        ' NumberOfComponents="3" format="binary">',
        f"          {_b64(disp)}",
        "        </DataArray>",
        '        <DataArray type="Float32" Name="displacement_magnitude"'
        ' NumberOfComponents="1" format="binary">',
        f"          {_b64(disp_mag)}",
        "        </DataArray>",
        '        <DataArray type="Float32" Name="von_mises"'
        ' NumberOfComponents="1" format="binary">',
        f"          {_b64(von_mises)}",
        "        </DataArray>",
        "      </PointData>",
        "    </Piece>",
        "  </PolyData>",
        "</VTKFile>",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")
