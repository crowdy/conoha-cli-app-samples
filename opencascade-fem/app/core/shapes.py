"""Parametric OpenCascade shape gallery."""
from __future__ import annotations

from dataclasses import dataclass

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Pnt, gp_Ax2, gp_Dir
from OCC.Core.TopoDS import TopoDS_Shape, topods
from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.BRep import BRep_Tool
from OCC.Core.BRepAdaptor import BRepAdaptor_Surface


FaceTags = dict[str, list[int]]


@dataclass(frozen=True)
class _ShapeMeta:
    defaults: dict
    ranges: dict


_META: dict[str, _ShapeMeta] = {
    "bracket": _ShapeMeta(
        defaults={"base_len": 80.0, "base_thk": 10.0, "wall_h": 60.0, "wall_thk": 8.0, "width": 40.0},
        ranges={
            "base_len": (40.0, 200.0),
            "base_thk": (4.0, 25.0),
            "wall_h": (30.0, 200.0),
            "wall_thk": (4.0, 25.0),
            "width": (20.0, 120.0),
        },
    ),
    "plate_hole": _ShapeMeta(
        defaults={"length": 120.0, "width": 60.0, "thickness": 5.0, "hole_radius": 8.0},
        ranges={
            "length": (40.0, 300.0),
            "width": (20.0, 200.0),
            "thickness": (2.0, 20.0),
            "hole_radius": (1.0, 80.0),
        },
    ),
    "cantilever_ibeam": _ShapeMeta(
        defaults={"length": 200.0, "height": 40.0, "flange_w": 30.0,
                  "flange_t": 5.0, "web_t": 4.0},
        ranges={
            "length": (80.0, 600.0),
            "height": (20.0, 120.0),
            "flange_w": (15.0, 100.0),
            "flange_t": (2.0, 15.0),
            "web_t": (2.0, 15.0),
        },
    ),
}


def defaults(kind: str) -> dict:
    return dict(_META[kind].defaults)


def ranges(kind: str) -> dict:
    return dict(_META[kind].ranges)


def kinds() -> list[str]:
    return list(_META.keys())


def build(kind: str, params: dict) -> tuple[TopoDS_Shape, FaceTags]:
    if kind == "bracket":
        return _build_bracket(params)
    if kind == "plate_hole":
        return _build_plate_hole(params)
    if kind == "cantilever_ibeam":
        return _build_ibeam(params)
    raise ValueError(f"unknown shape kind: {kind}")


def _build_bracket(p: dict) -> tuple[TopoDS_Shape, FaceTags]:
    base_len, base_thk = float(p["base_len"]), float(p["base_thk"])
    wall_h, wall_thk, width = float(p["wall_h"]), float(p["wall_thk"]), float(p["width"])

    base = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), base_len, width, base_thk).Shape()
    wall = BRepPrimAPI_MakeBox(
        gp_Pnt(0, 0, base_thk), wall_thk, width, wall_h
    ).Shape()
    shape = BRepAlgoAPI_Fuse(base, wall).Shape()

    fixed = _faces_with_normal(shape, axis=(0, 0, -1), at_height=0.0)
    load = _faces_with_normal(shape, axis=(0, 0, 1), at_height=base_thk + wall_h)
    return shape, {"fixed": fixed, "load": load}


def _build_plate_hole(p: dict) -> tuple[TopoDS_Shape, FaceTags]:
    L, W, T, R = float(p["length"]), float(p["width"]), float(p["thickness"]), float(p["hole_radius"])
    if R >= min(L, W) / 2.0:
        raise ValueError("hole_radius must be smaller than half the plate's shortest side")

    plate = BRepPrimAPI_MakeBox(gp_Pnt(0, 0, 0), L, W, T).Shape()
    axis = gp_Ax2(gp_Pnt(L / 2.0, W / 2.0, -T), gp_Dir(0, 0, 1))
    cyl = BRepPrimAPI_MakeCylinder(axis, R, 3.0 * T).Shape()
    shape = BRepAlgoAPI_Cut(plate, cyl).Shape()

    # short ends: X=0 (fixed), X=L (load)
    fixed = _faces_with_normal(shape, axis=(-1, 0, 0), at_height=0.0)
    load = _faces_with_normal(shape, axis=(1, 0, 0), at_height=L)
    return shape, {"fixed": fixed, "load": load}


def _build_ibeam(p: dict) -> tuple[TopoDS_Shape, FaceTags]:
    L = float(p["length"])
    H = float(p["height"])
    bf, tf = float(p["flange_w"]), float(p["flange_t"])
    tw = float(p["web_t"])
    if tf * 2 >= H:
        raise ValueError("flange_t*2 must be smaller than height")
    if tw >= bf:
        raise ValueError("web_t must be smaller than flange_w")

    # bottom flange centered on Y=0; X along beam length
    y_low = -bf / 2.0
    bot = BRepPrimAPI_MakeBox(gp_Pnt(0, y_low, 0), L, bf, tf).Shape()
    top = BRepPrimAPI_MakeBox(gp_Pnt(0, y_low, H - tf), L, bf, tf).Shape()
    web = BRepPrimAPI_MakeBox(gp_Pnt(0, -tw / 2.0, tf), L, tw, H - 2.0 * tf).Shape()
    shape = BRepAlgoAPI_Fuse(BRepAlgoAPI_Fuse(bot, web).Shape(), top).Shape()

    fixed = _faces_with_normal(shape, axis=(-1, 0, 0), at_height=0.0)
    load = _faces_with_normal(shape, axis=(1, 0, 0), at_height=L)
    return shape, {"fixed": fixed, "load": load}


def _faces_with_normal(shape: TopoDS_Shape, axis: tuple[float, float, float], at_height: float) -> list[int]:
    """Return face indices (1-based in topological order) whose plane has the
    given outward normal and lies at the given height along that axis.
    """
    idx: list[int] = []
    expl = TopExp_Explorer(shape, TopAbs_FACE)
    i = 0
    while expl.More():
        i += 1
        face = topods.Face(expl.Current())
        surf = BRepAdaptor_Surface(face)
        if surf.GetType() == 0:  # plane
            pln = surf.Plane()
            n = pln.Axis().Direction()
            # Apply face orientation: REVERSED means the natural plane normal
            # points inward, so flip to get the outward face normal.
            sign = -1.0 if face.Orientation() == TopAbs_REVERSED else 1.0
            normal = (sign * n.X(), sign * n.Y(), sign * n.Z())
            loc = pln.Location()
            here = loc.X() * axis[0] + loc.Y() * axis[1] + loc.Z() * axis[2]
            if all(abs(normal[k] - axis[k]) < 1e-6 for k in range(3)) and abs(here - at_height) < 1e-6:
                idx.append(i)
        expl.Next()
    return idx
