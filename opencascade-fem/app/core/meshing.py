"""OpenCascade → STEP → gmsh → MSH bridge."""
from __future__ import annotations

from pathlib import Path

import gmsh
from OCC.Core.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCC.Core.Interface import Interface_Static


def mesh(shape, face_tags: dict, mesh_size: float, work_dir: Path) -> Path:
    """Mesh ``shape`` with characteristic length ``mesh_size``.

    ``face_tags`` maps logical name → face descriptor.  Two formats supported:

    * **list[int]**  — legacy topology-index format (1-based TopExp_Explorer order).
    * **list[dict]** — bounding-box format; each dict has keys ``axis`` (3-tuple)
      and ``at_height`` (float).  Surfaces are matched by projecting their
      centre-of-mass onto ``axis`` and comparing to ``at_height``.

    Side effects: writes ``shape.step`` and ``mesh.msh`` under ``work_dir``.
    Returns the path to ``mesh.msh``.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    step_path = work_dir / "shape.step"
    msh_path = work_dir / "mesh.msh"

    _write_step(shape, step_path)

    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setNumber("Mesh.CharacteristicLengthMin", mesh_size * 0.3)
        gmsh.option.setNumber("Mesh.CharacteristicLengthMax", mesh_size)
        gmsh.option.setNumber("Mesh.MshFileVersion", 4.1)

        gmsh.model.occ.importShapes(str(step_path))
        gmsh.model.occ.synchronize()

        for name, descriptors in face_tags.items():
            surface_tags = _resolve_surfaces(name, descriptors)
            if not surface_tags:
                raise RuntimeError(
                    f"no surfaces matched face tag '{name}' (descriptors={descriptors})"
                )
            pg = gmsh.model.addPhysicalGroup(2, surface_tags)
            gmsh.model.setPhysicalName(2, pg, name)

        # also tag the bulk solid so meshio retains a 'volume' cell_set
        solids = [t for (dim, t) in gmsh.model.getEntities(3)]
        if solids:
            pg = gmsh.model.addPhysicalGroup(3, solids)
            gmsh.model.setPhysicalName(3, pg, "volume")

        gmsh.model.mesh.generate(3)
        gmsh.write(str(msh_path))
    finally:
        gmsh.finalize()

    return msh_path


def _resolve_surfaces(name: str, descriptors: list) -> list[int]:
    """Return gmsh surface tags for the given face descriptors.

    Supports two descriptor formats:
    - list[int]: topology indices (Option B) — map by index into getEntities(2)
    - list[dict]: bounding-box dicts with 'axis' and 'at_height' keys (Option A)
    """
    if not descriptors:
        return []

    all_surfaces = [t for (dim, t) in gmsh.model.getEntities(2)]

    # Detect format from first element
    if isinstance(descriptors[0], dict):
        # Option A: axis + at_height matching via centre-of-mass projection
        result = []
        for desc in descriptors:
            result.extend(
                _surfaces_at_normal_and_position(desc["axis"], desc["at_height"])
            )
        return list(dict.fromkeys(result))  # deduplicate, preserve order
    else:
        # Option B: topology-index (1-based) → position in sorted surface list
        sorted_surfaces = sorted(all_surfaces)
        result = []
        for idx in descriptors:
            # idx is 1-based; map to the idx-th surface tag in sorted order
            if 1 <= idx <= len(sorted_surfaces):
                result.append(sorted_surfaces[idx - 1])
        return result


def _surfaces_at_normal_and_position(
    axis: tuple[float, float, float],
    at_height: float,
    tol: float = 1e-3,
) -> list[int]:
    """Return gmsh surface tags whose centre-of-mass projects to ``at_height`` along ``axis``."""
    surfs = []
    for (dim, t) in gmsh.model.getEntities(2):
        com = gmsh.model.occ.getCenterOfMass(2, t)
        proj = sum(com[i] * axis[i] for i in range(3))
        if abs(proj - at_height) < tol:
            surfs.append(t)
    return surfs


def _write_step(shape, path: Path) -> None:
    writer = STEPControl_Writer()
    Interface_Static.SetCVal("write.step.schema", "AP203")
    writer.Transfer(shape, STEPControl_AsIs)
    status = writer.Write(str(path))
    if status != 1:
        raise RuntimeError(f"STEPControl_Writer.Write returned status={status}")
