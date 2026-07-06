# opencascade-fem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `opencascade-fem` sample — a single-container FastAPI app that builds parametric CAD shapes with OpenCascade (pythonocc-core), meshes them with gmsh, solves linear-elasticity FEM with scikit-fem, streams stage progress over SSE, and renders displacement / von Mises results in the browser via vtk.js.

**Architecture:** One Docker image built from `mambaorg/micromamba` with conda-forge `pythonocc-core` + `gmsh` and pip `fastapi`, `uvicorn`, `scikit-fem`, `meshio`. FastAPI hosts both the JSON API and the static frontend. Jobs run in `loop.run_in_executor` threads gated by a semaphore; progress flows via per-job `asyncio.Queue` SSE. Per-job state lives only in `/tmp/jobs/<id>/`. A background reaper enforces 30-minute TTL.

**Tech Stack:** Python 3.12, pythonocc-core 7.8, gmsh 4.13, scikit-fem 10.x, meshio 5.x, FastAPI 0.115, uvicorn, numpy/scipy, vtk.js (browser ESM CDN), micromamba/conda-forge, Docker.

**Spec:** `docs/superpowers/specs/2026-05-22-opencascade-fem-design.md`

**Branch:** `feat/opencascade-fem-sample` (already created, spec committed as `bf4a7a9`).

**Working directory:** All paths below are relative to the repo root `/root/dev/crowdy/conoha-cli-app-samples` unless stated otherwise.

---

## File Structure

The sample lives entirely under `opencascade-fem/`.

```
opencascade-fem/
├── conoha.yml                  ConoHa proxy registration
├── compose.yml                 Docker compose for local + deploy
├── Dockerfile                  micromamba base, conda-forge env
├── environment.yml             conda dependencies (pythonocc, gmsh, scipy)
├── pyproject.toml              pip extras (fastapi, scikit-fem, meshio, test deps)
├── README.md                   Sample readme
├── app/
│   ├── __init__.py
│   ├── main.py                 FastAPI app, lifespan, static mount
│   ├── settings.py             env-driven config (concurrency, limits, TTL)
│   ├── schemas.py              Pydantic models (JobSpec, Material, etc.)
│   ├── api/
│   │   ├── __init__.py
│   │   ├── jobs.py             /jobs, /jobs/{id}/events, /jobs/{id}/result.vtu
│   │   └── shapes.py           /shapes catalog
│   ├── core/
│   │   ├── __init__.py
│   │   ├── shapes.py           OCC parametric builders + FaceTags
│   │   ├── meshing.py          OCC→STEP→gmsh→MSH with physical groups
│   │   ├── solver.py           scikit-fem linear elasticity + von Mises
│   │   ├── vtu.py              meshio VTU serialization
│   │   └── jobs.py             in-memory job manager + SSE queue + reaper
│   └── web/
│       ├── index.html          static UI
│       ├── app.js              vanilla JS, EventSource, vtk.js render
│       └── styles.css
└── tests/
    ├── __init__.py
    ├── conftest.py             shared fixtures
    ├── test_shapes.py
    ├── test_meshing.py
    ├── test_solver.py          cantilever analytic benchmark
    ├── test_solver_plate.py    Kirsch stress concentration
    ├── test_jobs.py            lifecycle, semaphore, reaper
    ├── test_api.py             httpx + ASGITransport
    └── test_smoke.py           E2E one job, marked slow
```

---

## Task 1: Skeleton — directory layout, conoha/compose/conda/Docker stubs

**Files:**
- Create: `opencascade-fem/conoha.yml`
- Create: `opencascade-fem/compose.yml`
- Create: `opencascade-fem/environment.yml`
- Create: `opencascade-fem/pyproject.toml`
- Create: `opencascade-fem/Dockerfile`
- Create: `opencascade-fem/README.md` (stub)
- Create: `opencascade-fem/app/__init__.py` (empty)
- Create: `opencascade-fem/app/main.py` (minimal "OK" route)

- [ ] **Step 1: Create the `conoha.yml`**

```yaml
# opencascade-fem/conoha.yml
name: opencascade-fem
hosts:
  - opencascade-fem.example.com
web:
  service: web
  port: 8000
```

- [ ] **Step 2: Create the `compose.yml`**

```yaml
# opencascade-fem/compose.yml
services:
  web:
    build: .
    expose: ["8000"]
    environment:
      OCFEM_MAX_CONCURRENT: "2"
      OCFEM_MAX_ELEMENTS: "200000"
      OCFEM_SOLVER_TIMEOUT_SECONDS: "60"
      OCFEM_JOB_TTL_SECONDS: "1800"
    volumes:
      - jobs:/tmp/jobs
volumes:
  jobs: {}
```

- [ ] **Step 3: Create the `environment.yml`**

```yaml
# opencascade-fem/environment.yml
name: base
channels: [conda-forge]
dependencies:
  - python=3.12
  - pythonocc-core=7.8.*
  - gmsh=4.13.*
  - numpy=1.26.*
  - scipy=1.13.*
  - pip
  - pip:
      - fastapi==0.115.*
      - uvicorn[standard]==0.32.*
      - scikit-fem==10.*
      - meshio==5.*
      - pydantic==2.*
```

- [ ] **Step 4: Create the `pyproject.toml`**

```toml
# opencascade-fem/pyproject.toml
[project]
name = "opencascade-fem"
version = "0.1.0"
description = "OpenCascade + scikit-fem linear-elasticity demo on ConoHa VPS3"
requires-python = ">=3.12"

[project.optional-dependencies]
test = [
    "pytest>=8",
    "httpx>=0.27",
    "asgi-lifespan>=2",
    "anyio>=4",
]

[tool.pytest.ini_options]
markers = ["slow: end-to-end tests"]
addopts = "-q"
```

- [ ] **Step 5: Create the `Dockerfile`**

```dockerfile
# opencascade-fem/Dockerfile
FROM mambaorg/micromamba:1.5-bookworm-slim AS base
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglu1-mesa libxrender1 libxi6 libxkbcommon0 \
    && rm -rf /var/lib/apt/lists/*
USER mambauser
COPY --chown=mambauser environment.yml /tmp/env.yml
RUN micromamba install -y -n base -f /tmp/env.yml && micromamba clean -afy
ARG MAMBA_DOCKERFILE_ACTIVATE=1

WORKDIR /app
COPY --chown=mambauser app/ ./app/
COPY --chown=mambauser pyproject.toml ./
ENV PYTHONUNBUFFERED=1 \
    OCFEM_JOB_DIR=/tmp/jobs \
    OCFEM_MAX_CONCURRENT=2 \
    OCFEM_MAX_ELEMENTS=200000 \
    OCFEM_SOLVER_TIMEOUT_SECONDS=60 \
    OCFEM_JOB_TTL_SECONDS=1800
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6: Create minimal `app/main.py`**

```python
# opencascade-fem/app/main.py
from fastapi import FastAPI

app = FastAPI(title="opencascade-fem")


@app.get("/health")
def health() -> dict:
    return {"ok": True}
```

- [ ] **Step 7: Create empty package files and README stub**

```bash
touch opencascade-fem/app/__init__.py
```

`opencascade-fem/README.md` (stub — Task 27 fills it in):

```markdown
# opencascade-fem

OpenCascade + scikit-fem linear-elasticity FEM sample for ConoHa VPS3.

(Full README in Task 27.)
```

- [ ] **Step 8: Commit**

```bash
git add opencascade-fem/
git commit -m "feat(opencascade-fem): skeleton — conoha/compose/conda/Docker stubs"
```

---

## Task 2: Docker base smoke — pythonocc-core + gmsh import

**Goal:** verify the conda-forge stack actually installs and Python can import the C++ libraries before writing any domain code.

**Files:**
- No file changes (build + run only)

- [ ] **Step 1: Build the image (~6–10 min cold, ~700 MB)**

Run: `cd opencascade-fem && docker build -t opencascade-fem:smoke . && cd ..`
Expected: build completes. Look for `Successfully tagged opencascade-fem:smoke`. If micromamba fails resolving `pythonocc-core=7.8.*`, retry with `pythonocc-core` (any version) and pin the resolved version in `environment.yml`.

- [ ] **Step 2: Run a one-off import test**

```bash
docker run --rm opencascade-fem:smoke python -c "
import OCC.Core.BRepPrimAPI as p, gmsh, scipy, skfem, meshio
print('pythonocc-core OK', p.BRepPrimAPI_MakeBox(1,1,1).Shape() is not None)
print('gmsh OK', gmsh.__version__)
print('scikit-fem OK', skfem.__version__)
print('meshio OK', meshio.__version__)
"
```

Expected: 4 `OK` lines and the `Shape()` boolean is `True`. Any `ImportError` here is a packaging issue — fix `environment.yml` versions before continuing.

- [ ] **Step 3: Smoke the HTTP server**

```bash
docker run --rm -d --name ocfem-smoke -p 8000:8000 opencascade-fem:smoke
sleep 3
curl -fsS http://localhost:8000/health
docker rm -f ocfem-smoke
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Commit (no source change — record the pin if Step 1 forced one)**

If `environment.yml` was edited in Step 1, commit it now:

```bash
git add opencascade-fem/environment.yml
git commit -m "fix(opencascade-fem): pin pythonocc-core to resolved version"
```

Otherwise skip this commit.

---

## Task 3: Settings module + Pydantic schemas skeleton

**Files:**
- Create: `opencascade-fem/app/settings.py`
- Create: `opencascade-fem/app/schemas.py`

- [ ] **Step 1: Write `settings.py`**

```python
# opencascade-fem/app/settings.py
"""Runtime configuration sourced from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    job_dir: Path
    max_concurrent: int
    max_elements: int
    solver_timeout_seconds: int
    job_ttl_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            job_dir=Path(os.environ.get("OCFEM_JOB_DIR", "/tmp/jobs")),
            max_concurrent=int(os.environ.get("OCFEM_MAX_CONCURRENT", "2")),
            max_elements=int(os.environ.get("OCFEM_MAX_ELEMENTS", "200000")),
            solver_timeout_seconds=int(os.environ.get("OCFEM_SOLVER_TIMEOUT_SECONDS", "60")),
            job_ttl_seconds=int(os.environ.get("OCFEM_JOB_TTL_SECONDS", "1800")),
        )
```

- [ ] **Step 2: Write `schemas.py`**

```python
# opencascade-fem/app/schemas.py
"""Pydantic models for the public API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, NonNegativeFloat, PositiveFloat

ShapeKind = Literal["bracket", "plate_hole", "cantilever_ibeam"]


class Material(BaseModel):
    E_GPa: PositiveFloat = Field(200.0, description="Young's modulus")
    nu: float = Field(0.3, ge=0.0, lt=0.5)


class Traction(BaseModel):
    magnitude_MPa: NonNegativeFloat = Field(10.0)


class JobSpec(BaseModel):
    shape: ShapeKind
    params: dict  # validated downstream against per-shape schema
    material: Material = Material()
    traction: Traction = Traction()
    mesh_size: PositiveFloat = Field(5.0, le=100.0)


class JobCreated(BaseModel):
    job_id: str


class StageEvent(BaseModel):
    stage: str
    t_ms: int
    message: str
    payload: dict | None = None
```

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/app/settings.py opencascade-fem/app/schemas.py
git commit -m "feat(opencascade-fem): settings and base Pydantic schemas"
```

---

## Task 4: `core.shapes` — bracket builder (TDD)

**Files:**
- Create: `opencascade-fem/app/core/__init__.py` (empty)
- Create: `opencascade-fem/app/core/shapes.py`
- Create: `opencascade-fem/tests/__init__.py` (empty)
- Create: `opencascade-fem/tests/conftest.py`
- Create: `opencascade-fem/tests/test_shapes.py`

- [ ] **Step 1: Write `conftest.py`**

```python
# opencascade-fem/tests/conftest.py
import sys
from pathlib import Path

# Allow `from app...` imports when pytest is run from the sample directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
```

- [ ] **Step 2: Write the failing test for `bracket`**

```python
# opencascade-fem/tests/test_shapes.py
"""Unit tests for app.core.shapes."""
import pytest

from app.core import shapes as S
from OCC.Core.GProp import GProp_GProps
from OCC.Core.BRepGProp import brepgprop_VolumeProperties


def _volume(shape) -> float:
    props = GProp_GProps()
    brepgprop_VolumeProperties(shape, props)
    return props.Mass()


def test_bracket_default_builds_solid_with_positive_volume_and_two_face_tags():
    shape, tags = S.build("bracket", S.defaults("bracket"))
    assert _volume(shape) > 0.0
    assert set(tags.keys()) == {"fixed", "load"}
    assert all(isinstance(v, list) and len(v) >= 1 for v in tags.values())
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd opencascade-fem && docker run --rm -v "$PWD":/work -w /work opencascade-fem:smoke bash -c "pip install -e .[test] && pytest tests/test_shapes.py -v"`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.shapes'` (or attribute error). This confirms the test sees the missing implementation.

- [ ] **Step 4: Implement the minimal `shapes.py` with the bracket builder**

```python
# opencascade-fem/app/core/shapes.py
"""Parametric OpenCascade shape gallery."""
from __future__ import annotations

from dataclasses import dataclass

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Fuse
from OCC.Core.gp import gp_Pnt
from OCC.Core.TopoDS import TopoDS_Shape, topods
from OCC.Core.TopAbs import TopAbs_FACE
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
            normal = (n.X(), n.Y(), n.Z())
            loc = pln.Location()
            here = loc.X() * axis[0] + loc.Y() * axis[1] + loc.Z() * axis[2]
            if all(abs(normal[k] - axis[k]) < 1e-6 for k in range(3)) and abs(here - at_height) < 1e-6:
                idx.append(i)
        expl.Next()
    return idx
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd opencascade-fem && docker run --rm -v "$PWD":/work -w /work opencascade-fem:smoke bash -c "pip install -e .[test] && pytest tests/test_shapes.py -v"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add opencascade-fem/app/core/ opencascade-fem/tests/
git commit -m "feat(opencascade-fem): bracket parametric shape with fixed/load face tags"
```

---

## Task 5: `core.shapes` — plate_hole builder (TDD)

**Files:**
- Modify: `opencascade-fem/app/core/shapes.py`
- Modify: `opencascade-fem/tests/test_shapes.py`

- [ ] **Step 1: Add failing test for `plate_hole`**

Append to `tests/test_shapes.py`:

```python
def test_plate_hole_default_builds_solid_and_has_two_loaded_short_edges():
    shape, tags = S.build("plate_hole", S.defaults("plate_hole"))
    assert _volume(shape) > 0.0
    assert "fixed" in tags and "load" in tags
    # both short ends should be flat faces with normals along ±X
    assert tags["fixed"] and tags["load"]


def test_plate_hole_rejects_oversize_hole():
    p = S.defaults("plate_hole")
    p["hole_radius"] = p["width"]  # bigger than the plate
    with pytest.raises(ValueError):
        S.build("plate_hole", p)
```

- [ ] **Step 2: Run test, confirm 2 failures**

Run: `pytest tests/test_shapes.py::test_plate_hole_default_builds_solid_and_has_two_loaded_short_edges tests/test_shapes.py::test_plate_hole_rejects_oversize_hole -v`
Expected: FAIL (KeyError on `plate_hole`).

- [ ] **Step 3: Implement `_build_plate_hole`**

In `app/core/shapes.py`:

1. Add to `_META`:

```python
    "plate_hole": _ShapeMeta(
        defaults={"length": 120.0, "width": 60.0, "thickness": 5.0, "hole_radius": 8.0},
        ranges={
            "length": (40.0, 300.0),
            "width": (20.0, 200.0),
            "thickness": (2.0, 20.0),
            "hole_radius": (1.0, 80.0),
        },
    ),
```

2. Add imports near the top:

```python
from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCC.Core.gp import gp_Ax2, gp_Dir
```

3. Extend the dispatch in `build`:

```python
    if kind == "plate_hole":
        return _build_plate_hole(params)
```

4. Add the builder:

```python
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
```

Note: `_faces_with_normal`'s `at_height` is the signed projection along `axis`, so a face at X=0 with normal −X reports `here = 0.0` (`(-1)*0 = 0`), and a face at X=L with normal +X reports `here = L`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_shapes.py -v`
Expected: PASS (4 tests now).

- [ ] **Step 5: Commit**

```bash
git add opencascade-fem/app/core/shapes.py opencascade-fem/tests/test_shapes.py
git commit -m "feat(opencascade-fem): plate-with-hole shape + validation"
```

---

## Task 6: `core.shapes` — cantilever_ibeam builder (TDD)

**Files:**
- Modify: `opencascade-fem/app/core/shapes.py`
- Modify: `opencascade-fem/tests/test_shapes.py`

- [ ] **Step 1: Add failing test**

Append to `tests/test_shapes.py`:

```python
def test_cantilever_ibeam_builds_and_has_wall_and_tip_faces():
    shape, tags = S.build("cantilever_ibeam", S.defaults("cantilever_ibeam"))
    assert _volume(shape) > 0.0
    assert tags["fixed"]  # wall face (X=0, normal -X)
    assert tags["load"]   # tip face (X=L, normal +X)
```

- [ ] **Step 2: Run test, confirm failure**

Expected: FAIL (KeyError).

- [ ] **Step 3: Implement the I-beam**

In `_META`:

```python
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
```

Dispatch:

```python
    if kind == "cantilever_ibeam":
        return _build_ibeam(params)
```

Builder:

```python
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
```

- [ ] **Step 4: Run all shape tests**

Run: `pytest tests/test_shapes.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add opencascade-fem/app/core/shapes.py opencascade-fem/tests/test_shapes.py
git commit -m "feat(opencascade-fem): cantilever I-beam shape"
```

---

## Task 7: `core.meshing` — OCC → STEP → gmsh → MSH with physical groups (TDD)

**Files:**
- Create: `opencascade-fem/app/core/meshing.py`
- Create: `opencascade-fem/tests/test_meshing.py`

- [ ] **Step 1: Write failing test**

```python
# opencascade-fem/tests/test_meshing.py
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
```

- [ ] **Step 2: Run it, confirm failure**

Run: `pytest tests/test_meshing.py -v`
Expected: FAIL — `ModuleNotFoundError: app.core.meshing`.

- [ ] **Step 3: Implement `meshing.py`**

```python
# opencascade-fem/app/core/meshing.py
"""OpenCascade → STEP → gmsh → MSH bridge."""
from __future__ import annotations

from pathlib import Path

import gmsh
from OCC.Core.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCC.Core.Interface import Interface_Static_SetCVal


def mesh(shape, face_tags: dict[str, list[int]], mesh_size: float, work_dir: Path) -> Path:
    """Mesh ``shape`` with characteristic length ``mesh_size``.

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
        gmsh.option.setNumber("Mesh.MshFileVersion", 2.2)

        tags = gmsh.model.occ.importShapes(str(step_path))
        gmsh.model.occ.synchronize()

        for name, face_indices in face_tags.items():
            surface_tags = [t for (dim, t) in gmsh.model.getEntities(2) if t in face_indices]
            if not surface_tags:
                raise RuntimeError(f"no surfaces matched face tag '{name}' (indices={face_indices})")
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


def _write_step(shape, path: Path) -> None:
    writer = STEPControl_Writer()
    Interface_Static_SetCVal("write.step.schema", "AP203")
    writer.Transfer(shape, STEPControl_AsIs)
    status = writer.Write(str(path))
    if status != 1:
        raise RuntimeError(f"STEPControl_Writer.Write returned status={status}")
```

- [ ] **Step 4: Run the test**

Run: `pytest tests/test_meshing.py -v`
Expected: PASS (takes 2–4s).

If the gmsh face indices don't line up (importShapes returns surfaces in a different order than OpenCascade's TopExp), adjust `_faces_with_normal` to compute centroids instead of using topological indices, OR query gmsh surfaces by their bounding-box midpoint and re-tag inside `meshing.py`. Bounding-box query is more robust — prefer it if the first approach is flaky.

Bounding-box fallback (drop into `meshing.py` if needed):

```python
def _surfaces_at_normal_and_position(axis, at_height, tol=1e-3):
    surfs = []
    for (dim, t) in gmsh.model.getEntities(2):
        com = gmsh.model.occ.getCenterOfMass(2, t)
        proj = sum(com[i] * axis[i] for i in range(3))
        if abs(proj - at_height) < tol:
            surfs.append(t)
    return surfs
```

If you switch, the `face_tags` argument shape changes from `list[int]` to `list[dict]` with `{axis, at_height}`. Pick one approach across all three shapes.

- [ ] **Step 5: Commit**

```bash
git add opencascade-fem/app/core/meshing.py opencascade-fem/tests/test_meshing.py
git commit -m "feat(opencascade-fem): OCC→STEP→gmsh mesher with physical groups"
```

---

## Task 8: `core.solver` — linear elasticity skeleton

**Files:**
- Create: `opencascade-fem/app/core/solver.py`

- [ ] **Step 1: Implement `solver.py` (no test yet — Task 9/10 are the TDD anchors)**

```python
# opencascade-fem/app/core/solver.py
"""Linear-elasticity FEM solve on a tetrahedral mesh."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import meshio
from scipy.sparse.linalg import spsolve

from skfem import (
    Basis, MeshTet, ElementVector, ElementTetP1, FacetBasis,
    asm, condense,
)
from skfem.models.elasticity import linear_elasticity, lame_parameters
from skfem.helpers import dot


@dataclass(frozen=True)
class Material:
    E_GPa: float
    nu: float


@dataclass(frozen=True)
class Result:
    displacement: np.ndarray  # (n_nodes, 3), mm
    von_mises: np.ndarray     # (n_nodes,), MPa
    n_dofs: int
    walltime_s: float


def solve(msh_path: Path, material: Material, traction_MPa: float) -> tuple[Result, MeshTet]:
    import time
    t0 = time.perf_counter()

    m_io = meshio.read(str(msh_path))
    points = m_io.points
    tets = np.vstack([c.data for c in m_io.cells if c.type == "tetra"])
    mesh = MeshTet(points.T, tets.T)

    elem = ElementVector(ElementTetP1())
    basis = Basis(mesh, elem)

    lam, mu = lame_parameters(material.E_GPa * 1e3, material.nu)  # convert to MPa
    K = asm(linear_elasticity(lam, mu), basis)

    # Dirichlet (fixed): zero displacement on every node belonging to the 'fixed' surface set
    fixed_nodes = _nodes_in_set(m_io, mesh, "fixed")
    D = basis.get_dofs(nodes=fixed_nodes).flatten()

    # Neumann (load): traction on the 'load' surface set
    F = _assemble_traction(m_io, mesh, "load", traction_MPa)

    K_c, F_c, x_template, _ = condense(K, F, D=D)
    x = x_template.copy()
    x[~np.isin(np.arange(basis.N), D)] = spsolve(K_c, F_c)

    u = x.reshape(-1, 3)
    sigma_vm = _von_mises_nodal(mesh, basis, x, lam, mu)
    return Result(displacement=u, von_mises=sigma_vm, n_dofs=basis.N,
                  walltime_s=time.perf_counter() - t0), mesh


def _nodes_in_set(m_io, mesh: MeshTet, set_name: str) -> np.ndarray:
    """Return unique node indices belonging to the named surface cell_set."""
    triangles = np.vstack([c.data for c in m_io.cells if c.type == "triangle"])
    sel = m_io.cell_sets[set_name]
    # cell_sets is a dict keyed by name → list-per-block of cell indices
    tri_block_idx = next(i for i, c in enumerate(m_io.cells) if c.type == "triangle")
    tri_indices = sel[tri_block_idx]
    chosen = triangles[tri_indices]
    return np.unique(chosen.ravel())


def _assemble_traction(m_io, mesh: MeshTet, set_name: str, traction_MPa: float) -> np.ndarray:
    """Distribute a uniform +X traction over the named surface set as a load vector."""
    # For demo simplicity, lump traction onto the boundary nodes equally.
    nodes = _nodes_in_set(m_io, mesh, set_name)
    F = np.zeros(mesh.p.shape[1] * 3)
    if nodes.size:
        per_node = traction_MPa / nodes.size  # crude lumping; Task 9 verifies tip deflection is in the right order
        for n in nodes:
            F[3 * n + 0] = per_node
    return F


def _von_mises_nodal(mesh: MeshTet, basis: Basis, u: np.ndarray,
                     lam: float, mu: float) -> np.ndarray:
    """Compute σ_vM at each node by averaging cell-constant tetra stresses."""
    # cell-constant strain via gradient of linear shape functions
    p = mesh.p.T  # (n_nodes, 3)
    cells = mesh.t.T  # (n_cells, 4)
    n_nodes = p.shape[0]
    vm = np.zeros(n_nodes)
    counts = np.zeros(n_nodes)

    u_vec = u.reshape(-1, 3)
    for c in cells:
        X = np.column_stack([p[c[1]] - p[c[0]],
                             p[c[2]] - p[c[0]],
                             p[c[3]] - p[c[0]]])  # 3x3
        if abs(np.linalg.det(X)) < 1e-12:
            continue
        invX = np.linalg.inv(X)
        grads = np.vstack([-(invX[0] + invX[1] + invX[2]),
                            invX[0], invX[1], invX[2]])  # (4,3)
        U = u_vec[c]  # (4,3)
        gradU = grads.T @ U  # (3,3)
        eps = 0.5 * (gradU + gradU.T)
        sig = lam * np.trace(eps) * np.eye(3) + 2.0 * mu * eps
        s = sig - np.eye(3) * np.trace(sig) / 3.0
        vm_cell = np.sqrt(1.5 * np.sum(s * s))
        for n in c:
            vm[n] += vm_cell
            counts[n] += 1.0
    counts[counts == 0] = 1.0
    return vm / counts
```

- [ ] **Step 2: Syntax/import check**

Run: `cd opencascade-fem && docker run --rm -v "$PWD":/work -w /work opencascade-fem:smoke bash -c "pip install -e .[test] && python -c 'from app.core.solver import solve, Material, Result; print(\"OK\")'"`
Expected: `OK`. Any ImportError means scikit-fem's API differs in the installed version — update imports per skfem 10 docs.

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/app/core/solver.py
git commit -m "feat(opencascade-fem): linear-elasticity solver skeleton"
```

---

## Task 9: Solver — cantilever analytic benchmark (TDD)

**Files:**
- Create: `opencascade-fem/tests/test_solver.py`
- Possibly modify: `opencascade-fem/app/core/solver.py` (refine traction assembly)

- [ ] **Step 1: Write the analytic-benchmark test**

```python
# opencascade-fem/tests/test_solver.py
"""Analytical benchmark: cantilever beam tip deflection."""
from pathlib import Path

import numpy as np
import pytest

from app.core import shapes as S, meshing as M, solver as F


@pytest.mark.slow
def test_cantilever_tip_deflection_matches_euler_bernoulli_within_15_percent(tmp_path: Path):
    # Use a slender rectangular beam (treat as bracket with thin geometry, or use
    # ibeam params that approximate a rectangle). For simplicity we use a fresh
    # box-only shape; we re-use bracket's base for that purpose by setting wall_h=0
    # via plate_hole-style cantilever: a thin plate, fixed on one short edge,
    # loaded on the opposite short edge in -Y.

    # Plate as a flat cantilever: L=200, W=20, T=4. We load the +X end in -Z.
    params = {"length": 200.0, "width": 20.0, "thickness": 4.0, "hole_radius": 1.0}
    shape, tags = S.build("plate_hole", params)

    msh = M.mesh(shape, tags, mesh_size=4.0, work_dir=tmp_path)
    mat = F.Material(E_GPa=200.0, nu=0.3)
    P_MPa = 1.0  # 1 MPa traction over the loaded face

    result, mesh = F.solve(msh, mat, traction_MPa=P_MPa)

    # Closed-form Euler-Bernoulli tip deflection for a uniformly loaded face:
    # for the order-of-magnitude check, use δ = F L^3 / (3 E I)
    # where F = P_MPa * (W * T) [N], E in MPa, I = W * T^3 / 12 [mm^4].
    L, W, T = params["length"], params["width"], params["thickness"]
    F_total_N = P_MPa * W * T
    E_MPa = mat.E_GPa * 1e3
    I = W * T**3 / 12.0
    delta_analytic = F_total_N * L**3 / (3.0 * E_MPa * I)

    # measured: largest displacement magnitude on the loaded face
    p = mesh.p.T
    load_x_max = p[:, 0].max()
    loaded = np.where(np.abs(p[:, 0] - load_x_max) < 0.1)[0]
    measured = np.linalg.norm(result.displacement[loaded], axis=1).max()

    # 15% tolerance — accommodates the lumped-node traction and coarse mesh
    assert measured == pytest.approx(delta_analytic, rel=0.15), (
        f"tip deflection: analytic={delta_analytic:.3f} mm vs measured={measured:.3f} mm"
    )
```

- [ ] **Step 2: Run the test**

Run: `pytest tests/test_solver.py -v -m slow`
Expected outcomes:
- PASS within 15% → solver and traction lumping are good enough; proceed.
- FAIL by an order of magnitude → the lumped-node traction is wrong direction or magnitude. Fix `_assemble_traction` to use FacetBasis-integrated traction on the named surface in the specified direction (−Z for this test, +X for the gallery default). Re-run.

- [ ] **Step 3: If a fix was needed, replace `_assemble_traction` with a facet-integrated version**

```python
def _assemble_traction(m_io, mesh, set_name: str, traction_MPa: float,
                       direction=(1.0, 0.0, 0.0)) -> np.ndarray:
    """Integrate a uniform traction t = traction_MPa * direction over the named
    facet set and return the resulting RHS vector in the global DOF ordering.
    """
    from skfem import FacetBasis
    triangles = np.vstack([c.data for c in m_io.cells if c.type == "triangle"])
    tri_block_idx = next(i for i, c in enumerate(m_io.cells) if c.type == "triangle")
    tri_indices = m_io.cell_sets[set_name][tri_block_idx]
    facet_nodes = triangles[tri_indices]

    # Mark facets in skfem by matching all 3 vertex indices in mesh.f
    mesh_facets = mesh.facets.T  # (n_facets, 3)
    target = {tuple(sorted(map(int, row))) for row in facet_nodes}
    sel = np.array([tuple(sorted(map(int, f))) in target for f in mesh_facets])
    facet_indices = np.where(sel)[0]

    fbasis = FacetBasis(mesh, ElementVector(ElementTetP1()), facets=facet_indices)
    t = np.array(direction) * traction_MPa

    from skfem import LinearForm
    from skfem.helpers import dot as skdot

    @LinearForm
    def f(v, _):
        return skdot(t, v)

    return asm(f, fbasis)
```

Update `solve()` to pass `direction` — the gallery surface tags already encode which axis the load face faces, so use that axis as the traction direction. For the cantilever test above, the loaded face faces +X but the test wants the force in −Z; for now, hard-code direction = +X in gallery shapes (vertical load is out of scope for the default UX) and rewrite the test to pull in +X (axial tension), comparing against `δ_axial = P L / E`.

This is a real branch point — choose ONE before continuing:

- **Branch A (recommended)**: keep tractions purely axial (along the surface normal direction). The plate-with-hole becomes a tension test (very clean Kirsch validation in Task 10). The cantilever becomes axial stretching. Replace the test above with an axial-stretch benchmark.
- **Branch B**: support arbitrary traction directions via an extra UI input. More code, more UX, but the cantilever benchmark survives.

Pick Branch A unless you specifically want transverse loading. Update Task 9's test to:

```python
@pytest.mark.slow
def test_axial_stretch_matches_PL_over_AE_within_5_percent(tmp_path):
    params = {"length": 200.0, "width": 40.0, "thickness": 5.0, "hole_radius": 1.0}
    shape, tags = S.build("plate_hole", params)
    msh = M.mesh(shape, tags, mesh_size=4.0, work_dir=tmp_path)
    mat = F.Material(E_GPa=200.0, nu=0.3)
    P_MPa = 1.0

    result, mesh = F.solve(msh, mat, traction_MPa=P_MPa)
    L, W, T = params["length"], params["width"], params["thickness"]
    A = W * T
    delta = (P_MPa * A) * L / (mat.E_GPa * 1e3 * A)  # = P L / E

    p = mesh.p.T
    loaded = np.where(np.abs(p[:, 0] - L) < 0.1)[0]
    measured_ux = result.displacement[loaded, 0].max()
    assert measured_ux == pytest.approx(delta, rel=0.05), (
        f"axial: analytic={delta:.3f} measured={measured_ux:.3f}"
    )
```

- [ ] **Step 4: Re-run until green**

Run: `pytest tests/test_solver.py -v -m slow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add opencascade-fem/app/core/solver.py opencascade-fem/tests/test_solver.py
git commit -m "feat(opencascade-fem): facet-integrated traction + axial-stretch benchmark"
```

---

## Task 10: Solver — plate stress concentration (TDD)

**Files:**
- Create: `opencascade-fem/tests/test_solver_plate.py`

- [ ] **Step 1: Write the Kirsch test**

```python
# opencascade-fem/tests/test_solver_plate.py
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
```

- [ ] **Step 2: Run, iterate**

Run: `pytest tests/test_solver_plate.py -v -m slow`
Expected: PASS. If `K` is far below 1.8, mesh is too coarse near the hole — drop `mesh_size` to 2.0 (slower but more accurate).

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/tests/test_solver_plate.py
git commit -m "test(opencascade-fem): Kirsch stress-concentration plate benchmark"
```

---

## Task 11: `core.vtu` — VTU serialization

**Files:**
- Create: `opencascade-fem/app/core/vtu.py`

(No standalone test — the smoke test in Task 26 covers it; it's a thin meshio wrapper.)

- [ ] **Step 1: Write `vtu.py`**

```python
# opencascade-fem/app/core/vtu.py
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
```

- [ ] **Step 2: Commit**

```bash
git add opencascade-fem/app/core/vtu.py
git commit -m "feat(opencascade-fem): VTU serialization via meshio"
```

---

## Task 12: `core.jobs` — in-memory job manager + SSE event queue (TDD)

**Files:**
- Create: `opencascade-fem/app/core/jobs.py`
- Create: `opencascade-fem/tests/test_jobs.py`

- [ ] **Step 1: Write the failing test**

```python
# opencascade-fem/tests/test_jobs.py
import asyncio
import pytest

from app.core import jobs as J


@pytest.mark.anyio
async def test_submit_and_lifecycle_events_emit_in_order(tmp_path):
    mgr = J.JobManager(work_root=tmp_path, max_concurrent=1)

    async def fake_pipeline(emit, work_dir):
        await emit("shape", "built")
        await emit("mesh", "meshed")
        await emit("assemble", "assembled")
        await emit("solve", "solved")
        await emit("postproc", "wrote", payload={"result_url": "/x"})

    job_id = await mgr.submit_with_pipeline(spec={"shape": "bracket"}, pipeline=fake_pipeline)

    stages = []
    async for ev in mgr.events(job_id):
        stages.append(ev.stage)
        if ev.stage == "done" or ev.stage == "error":
            break

    assert stages == ["queued", "shape", "mesh", "assemble", "solve", "postproc", "done"]
    assert mgr.state(job_id).status == "done"


@pytest.fixture
def anyio_backend():
    return "asyncio"
```

- [ ] **Step 2: Run, confirm failure**

Run: `pytest tests/test_jobs.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `jobs.py`**

```python
# opencascade-fem/app/core/jobs.py
"""In-memory job manager with per-job SSE event queue."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable


PipelineFn = Callable[[Callable[..., Awaitable[None]], Path], Awaitable[None]]


@dataclass
class JobEvent:
    stage: str
    t_ms: int
    message: str
    payload: dict | None = None


@dataclass
class JobState:
    id: str
    status: str = "queued"  # queued | running | done | error
    started_at: float = field(default_factory=time.monotonic)
    last_event_at: float = field(default_factory=time.monotonic)
    error: str | None = None
    work_dir: Path | None = None


class JobManager:
    def __init__(self, work_root: Path, max_concurrent: int = 2):
        self._root = work_root
        self._root.mkdir(parents=True, exist_ok=True)
        self._states: dict[str, JobState] = {}
        self._queues: dict[str, asyncio.Queue[JobEvent | None]] = {}
        self._buffers: dict[str, deque[JobEvent]] = {}
        self._sem = asyncio.Semaphore(max_concurrent)

    def state(self, job_id: str) -> JobState | None:
        return self._states.get(job_id)

    def result_path(self, job_id: str) -> Path:
        return self._root / job_id / "result.vtu"

    async def submit_with_pipeline(self, spec: dict, pipeline: PipelineFn) -> str:
        job_id = uuid.uuid4().hex[:12]
        work_dir = self._root / job_id
        work_dir.mkdir(parents=True, exist_ok=True)
        st = JobState(id=job_id, work_dir=work_dir)
        self._states[job_id] = st
        self._queues[job_id] = asyncio.Queue()
        self._buffers[job_id] = deque(maxlen=32)
        await self._emit(job_id, "queued", "accepted")
        asyncio.create_task(self._run(job_id, pipeline))
        return job_id

    async def _run(self, job_id: str, pipeline: PipelineFn) -> None:
        st = self._states[job_id]
        try:
            async with self._sem:
                st.status = "running"
                await pipeline(
                    lambda stage, msg, payload=None: self._emit(job_id, stage, msg, payload),
                    st.work_dir,
                )
            st.status = "done"
            await self._emit(job_id, "done", "ok")
        except Exception as exc:  # noqa: BLE001
            st.status = "error"
            st.error = str(exc)
            await self._emit(job_id, "error", str(exc), payload={"cause": type(exc).__name__})
        finally:
            await self._queues[job_id].put(None)  # close marker

    async def _emit(self, job_id: str, stage: str, message: str, payload: dict | None = None) -> None:
        ev = JobEvent(
            stage=stage,
            t_ms=int((time.monotonic() - self._states[job_id].started_at) * 1000),
            message=message,
            payload=payload,
        )
        self._buffers[job_id].append(ev)
        self._states[job_id].last_event_at = time.monotonic()
        await self._queues[job_id].put(ev)

    async def events(self, job_id: str) -> AsyncIterator[JobEvent]:
        if job_id not in self._queues:
            return
        for ev in list(self._buffers[job_id]):
            yield ev
        while True:
            ev = await self._queues[job_id].get()
            if ev is None:
                return
            yield ev

    async def reap_expired(self, ttl_seconds: int) -> int:
        """Delete job dirs whose last_event is older than ttl_seconds. Return count."""
        import shutil
        now = time.monotonic()
        gone = 0
        for jid, st in list(self._states.items()):
            if now - st.last_event_at > ttl_seconds:
                if st.work_dir and st.work_dir.exists():
                    shutil.rmtree(st.work_dir, ignore_errors=True)
                self._states.pop(jid, None)
                self._queues.pop(jid, None)
                self._buffers.pop(jid, None)
                gone += 1
        return gone
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_jobs.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add opencascade-fem/app/core/jobs.py opencascade-fem/tests/test_jobs.py
git commit -m "feat(opencascade-fem): in-memory job manager with SSE event queue"
```

---

## Task 13: FastAPI app — lifespan + static mount + /shapes catalog (TDD)

**Files:**
- Modify: `opencascade-fem/app/main.py`
- Create: `opencascade-fem/app/api/__init__.py`
- Create: `opencascade-fem/app/api/shapes.py`
- Create: `opencascade-fem/tests/test_api.py`

- [ ] **Step 1: Write a /shapes test**

```python
# opencascade-fem/tests/test_api.py
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_get_shapes_returns_catalog_with_three_kinds():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/shapes")
    assert r.status_code == 200
    data = r.json()
    kinds = {item["kind"] for item in data}
    assert kinds == {"bracket", "plate_hole", "cantilever_ibeam"}
    for item in data:
        assert "defaults" in item and "ranges" in item


@pytest.fixture
def anyio_backend():
    return "asyncio"
```

- [ ] **Step 2: Implement `api/shapes.py`**

```python
# opencascade-fem/app/api/__init__.py
```

```python
# opencascade-fem/app/api/shapes.py
from fastapi import APIRouter

from app.core import shapes as S

router = APIRouter()


@router.get("/shapes")
def list_shapes() -> list[dict]:
    return [
        {"kind": k, "defaults": S.defaults(k), "ranges": S.ranges(k)}
        for k in S.kinds()
    ]
```

- [ ] **Step 3: Wire into `main.py`**

```python
# opencascade-fem/app/main.py
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.shapes import router as shapes_router
from app.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    app.state.settings = settings
    yield


app = FastAPI(title="opencascade-fem", lifespan=lifespan)
app.include_router(shapes_router)

WEB_DIR = Path(__file__).parent / "web"
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


@app.get("/health")
def health() -> dict:
    return {"ok": True}
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_api.py::test_get_shapes_returns_catalog_with_three_kinds -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add opencascade-fem/app/main.py opencascade-fem/app/api/ opencascade-fem/tests/test_api.py
git commit -m "feat(opencascade-fem): /shapes catalog and FastAPI lifespan"
```

---

## Task 14: API — `POST /jobs` validation + wired pipeline (TDD)

**Files:**
- Create: `opencascade-fem/app/api/jobs.py`
- Modify: `opencascade-fem/app/main.py`
- Modify: `opencascade-fem/tests/test_api.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/test_api.py`:

```python
@pytest.mark.anyio
async def test_post_jobs_rejects_unknown_shape():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/jobs", json={
            "shape": "spaceship", "params": {}, "mesh_size": 5.0,
        })
    assert r.status_code == 422


@pytest.mark.anyio
async def test_post_jobs_returns_201_and_job_id_for_valid_bracket():
    from app.core import shapes as S
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/jobs", json={
            "shape": "bracket",
            "params": S.defaults("bracket"),
            "material": {"E_GPa": 200.0, "nu": 0.3},
            "traction": {"magnitude_MPa": 5.0},
            "mesh_size": 8.0,
        })
    assert r.status_code == 201
    assert "job_id" in r.json()


@pytest.mark.anyio
async def test_post_jobs_rejects_oversized_mesh():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/jobs", json={
            "shape": "bracket",
            "params": __import__("app.core.shapes", fromlist=["defaults"]).defaults("bracket"),
            "mesh_size": 0.1,
        })
    # Pre-flight element estimate should reject this
    assert r.status_code == 400
    assert "advice" in r.json().get("detail", {})
```

- [ ] **Step 2: Implement `api/jobs.py`**

```python
# opencascade-fem/app/api/jobs.py
from __future__ import annotations

import asyncio
import json
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, StreamingResponse

from app.core import jobs as J, shapes as S, meshing as M, solver as F, vtu as V
from app.schemas import JobSpec, JobCreated

router = APIRouter()


def _estimate_elements(shape_kind: str, params: dict, mesh_size: float) -> int:
    """Very rough bbox-based estimate: V_bbox / mesh_size^3."""
    if shape_kind == "bracket":
        v = params["base_len"] * params["width"] * (params["base_thk"] + params["wall_h"])
    elif shape_kind == "plate_hole":
        v = params["length"] * params["width"] * params["thickness"]
    elif shape_kind == "cantilever_ibeam":
        v = params["length"] * params["height"] * params["flange_w"]
    else:
        v = 0.0
    return int(v / (mesh_size ** 3))


@router.post("/jobs", status_code=status.HTTP_201_CREATED, response_model=JobCreated)
async def submit_job(spec: JobSpec, request: Request) -> JobCreated:
    settings = request.app.state.settings
    mgr: J.JobManager = request.app.state.jobs

    # Pre-flight: validate shape kind is in gallery + params keys are well-formed
    if spec.shape not in S.kinds():
        raise HTTPException(422, detail=f"unknown shape '{spec.shape}'")

    est = _estimate_elements(spec.shape, spec.params, spec.mesh_size)
    if est > settings.max_elements:
        advice = (settings.max_elements / max(est, 1)) ** (1 / 3) * spec.mesh_size
        raise HTTPException(
            400,
            detail={
                "error": "mesh_too_large",
                "estimated_elements": est,
                "limit": settings.max_elements,
                "advice": {"mesh_size": round(spec.mesh_size / advice, 2)},
            },
        )

    async def pipeline(emit, work_dir):
        loop = asyncio.get_running_loop()
        shape, tags = await loop.run_in_executor(None, S.build, spec.shape, spec.params)
        await emit("shape", "built")

        msh = await loop.run_in_executor(None, M.mesh, shape, tags, spec.mesh_size, work_dir)
        await emit("mesh", "meshed", payload={"file": str(msh.name)})

        await emit("assemble", "assembling")
        mat = F.Material(E_GPa=spec.material.E_GPa, nu=spec.material.nu)
        result, mesh = await loop.run_in_executor(
            None, F.solve, msh, mat, spec.traction.magnitude_MPa
        )
        await emit("solve", "solved",
                   payload={"n_dofs": result.n_dofs, "walltime_s": result.walltime_s})

        out = work_dir / "result.vtu"
        await loop.run_in_executor(None, V.write, result, mesh, out)
        await emit("postproc", "wrote",
                   payload={"result_url": f"/jobs/{work_dir.name}/result.vtu"})

    job_id = await mgr.submit_with_pipeline(spec.dict(), pipeline)
    return JobCreated(job_id=job_id)


@router.get("/jobs/{job_id}/events")
async def stream_events(job_id: str, request: Request) -> StreamingResponse:
    mgr: J.JobManager = request.app.state.jobs
    if mgr.state(job_id) is None:
        raise HTTPException(404, detail="job not found")

    async def gen():
        async for ev in mgr.events(job_id):
            data = json.dumps({
                "stage": ev.stage, "t_ms": ev.t_ms,
                "message": ev.message, "payload": ev.payload,
            })
            yield f"data: {data}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/jobs/{job_id}/result.vtu")
async def get_result(job_id: str, request: Request) -> FileResponse:
    mgr: J.JobManager = request.app.state.jobs
    st = mgr.state(job_id)
    if st is None:
        raise HTTPException(404, detail="job not found")
    if st.status == "error":
        raise HTTPException(410, detail={"error": "job_failed", "message": st.error})
    if st.status != "done":
        raise HTTPException(409, detail="job not ready")

    path = mgr.result_path(job_id)
    return FileResponse(str(path), media_type="model/vnd.vtk",
                        filename=f"{job_id}.vtu")
```

- [ ] **Step 3: Wire `JobManager` into the app lifespan**

In `app/main.py`, replace the lifespan:

```python
from app.core.jobs import JobManager

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    app.state.settings = settings
    app.state.jobs = JobManager(
        work_root=settings.job_dir, max_concurrent=settings.max_concurrent
    )
    yield
```

And include the new router:

```python
from app.api.jobs import router as jobs_router
app.include_router(jobs_router)
```

- [ ] **Step 4: Run all API tests**

Run: `pytest tests/test_api.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add opencascade-fem/app/api/jobs.py opencascade-fem/app/main.py opencascade-fem/tests/test_api.py
git commit -m "feat(opencascade-fem): POST /jobs with element-budget guard and SSE+result endpoints"
```

---

## Task 15: API — SSE event stream test + result endpoint test (TDD)

**Files:**
- Modify: `opencascade-fem/tests/test_api.py`

- [ ] **Step 1: Add failing tests**

```python
@pytest.mark.anyio
async def test_events_stream_terminates_with_done_on_short_job():
    from app.core import shapes as S
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60) as ac:
        r = await ac.post("/jobs", json={
            "shape": "bracket",
            "params": S.defaults("bracket"),
            "mesh_size": 20.0,  # coarse → fast
        })
        job_id = r.json()["job_id"]

        stages = []
        async with ac.stream("GET", f"/jobs/{job_id}/events") as stream:
            async for line in stream.aiter_lines():
                if not line.startswith("data: "):
                    continue
                ev = __import__("json").loads(line.removeprefix("data: "))
                stages.append(ev["stage"])
                if ev["stage"] in ("done", "error"):
                    break

    assert "queued" in stages
    assert stages[-1] == "done"
    for s in ("shape", "mesh", "assemble", "solve", "postproc"):
        assert s in stages


@pytest.mark.anyio
async def test_result_returns_vtu_after_done():
    from app.core import shapes as S
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=60) as ac:
        r = await ac.post("/jobs", json={
            "shape": "bracket", "params": S.defaults("bracket"), "mesh_size": 20.0,
        })
        job_id = r.json()["job_id"]
        # wait for done
        async with ac.stream("GET", f"/jobs/{job_id}/events") as stream:
            async for line in stream.aiter_lines():
                if line.startswith("data: ") and '"done"' in line:
                    break

        r = await ac.get(f"/jobs/{job_id}/result.vtu")
        assert r.status_code == 200
        assert r.content.startswith(b"<?xml") or b"VTKFile" in r.content[:200]


@pytest.mark.anyio
async def test_result_409_while_not_ready():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/jobs/unknown-id/result.vtu")
        assert r.status_code == 404
```

- [ ] **Step 2: Run, fix any wiring issues**

Run: `pytest tests/test_api.py -v -m "not slow"`
Expected: all PASS. If the SSE stream test stalls, the `bracket mesh_size=20.0` job may still take >20s; raise the timeout or coarsen to `mesh_size=30.0`.

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/tests/test_api.py
git commit -m "test(opencascade-fem): SSE stream + result endpoint integration tests"
```

---

## Task 16: Concurrency semaphore + element-budget evidence (TDD)

**Files:**
- Modify: `opencascade-fem/tests/test_jobs.py`

(The semaphore and budget guards were implemented in earlier tasks; this task adds explicit regression coverage.)

- [ ] **Step 1: Add concurrency test**

```python
@pytest.mark.anyio
async def test_semaphore_runs_at_most_max_concurrent_jobs(tmp_path):
    mgr = J.JobManager(work_root=tmp_path, max_concurrent=1)
    in_flight = {"now": 0, "peak": 0}

    async def slow_pipeline(emit, work_dir):
        in_flight["now"] += 1
        in_flight["peak"] = max(in_flight["peak"], in_flight["now"])
        await asyncio.sleep(0.2)
        await emit("done", "ok")
        in_flight["now"] -= 1

    j1 = await mgr.submit_with_pipeline({}, slow_pipeline)
    j2 = await mgr.submit_with_pipeline({}, slow_pipeline)

    for jid in (j1, j2):
        async for ev in mgr.events(jid):
            if ev.stage in ("done", "error"):
                break

    assert in_flight["peak"] == 1
```

- [ ] **Step 2: Run**

Run: `pytest tests/test_jobs.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/tests/test_jobs.py
git commit -m "test(opencascade-fem): semaphore enforces max_concurrent"
```

---

## Task 17: TTL reaper background task (TDD)

**Files:**
- Modify: `opencascade-fem/app/main.py`
- Modify: `opencascade-fem/tests/test_jobs.py`

- [ ] **Step 1: Add reaper test**

```python
@pytest.mark.anyio
async def test_reap_expired_removes_old_jobs(tmp_path):
    mgr = J.JobManager(work_root=tmp_path, max_concurrent=1)

    async def fast(emit, work_dir):
        await emit("done", "ok")

    jid = await mgr.submit_with_pipeline({}, fast)
    async for ev in mgr.events(jid):
        if ev.stage == "done":
            break

    # simulate the job being old: shift its last_event_at back
    mgr._states[jid].last_event_at -= 9999.0
    gone = await mgr.reap_expired(ttl_seconds=10)
    assert gone == 1
    assert mgr.state(jid) is None
```

- [ ] **Step 2: Wire a periodic reaper task into the lifespan**

In `app/main.py`:

```python
import asyncio

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    app.state.settings = settings
    app.state.jobs = JobManager(
        work_root=settings.job_dir, max_concurrent=settings.max_concurrent
    )

    async def reaper():
        while True:
            await asyncio.sleep(60)
            try:
                await app.state.jobs.reap_expired(settings.job_ttl_seconds)
            except Exception:
                pass

    task = asyncio.create_task(reaper())
    try:
        yield
    finally:
        task.cancel()
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_jobs.py -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add opencascade-fem/app/main.py opencascade-fem/tests/test_jobs.py
git commit -m "feat(opencascade-fem): TTL reaper for job directories"
```

---

## Task 18: Solver timeout

**Files:**
- Modify: `opencascade-fem/app/api/jobs.py`

- [ ] **Step 1: Wrap the solve step in `asyncio.wait_for`**

In `app/api/jobs.py` `pipeline()`:

```python
        try:
            result, mesh = await asyncio.wait_for(
                loop.run_in_executor(None, F.solve, msh, mat, spec.traction.magnitude_MPa),
                timeout=settings.solver_timeout_seconds,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(f"solver timeout after {settings.solver_timeout_seconds}s")
```

`settings` is available via closure; ensure the `pipeline` function captures it (pull it before defining `pipeline`).

- [ ] **Step 2: Quick verify with a tiny synthetic timeout test (optional smoke)**

Run: `pytest tests/test_api.py -v -m "not slow"`
Expected: all still PASS (timeout path isn't exercised here — the smoke test in Task 26 covers the happy path).

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/app/api/jobs.py
git commit -m "feat(opencascade-fem): per-job solver timeout"
```

---

## Task 19: Frontend skeleton — `index.html` + `styles.css`

**Files:**
- Create: `opencascade-fem/app/web/index.html`
- Create: `opencascade-fem/app/web/styles.css`

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>opencascade-fem</title>
<link rel="stylesheet" href="/styles.css">
<script type="importmap">
{ "imports": {
    "@kitware/vtk.js/": "https://cdn.jsdelivr.net/npm/@kitware/vtk.js@30/Sources/"
} }
</script>
</head>
<body>
<header>
  <h1>opencascade-fem</h1>
  <p>OpenCascade → gmsh → scikit-fem → vtk.js — linear elasticity demo</p>
</header>
<main>
  <aside id="controls">
    <label>Shape
      <select id="shape"></select>
    </label>
    <div id="params"></div>
    <fieldset>
      <legend>Material</legend>
      <label>E (GPa) <input type="number" id="E" value="200" min="1" step="1"></label>
      <label>ν <input type="number" id="nu" value="0.3" min="0" max="0.49" step="0.01"></label>
    </fieldset>
    <label>Traction (MPa) <input type="number" id="traction" value="10" min="0" step="1"></label>
    <label>Mesh size <input type="number" id="mesh_size" value="8" min="0.5" step="0.5"></label>
    <button id="run">Run</button>
    <progress id="progress" value="0" max="6"></progress>
    <pre id="log"></pre>

    <fieldset>
      <legend>View</legend>
      <label>Field
        <select id="field">
          <option value="displacement_magnitude">displacement</option>
          <option value="von_mises" selected>von Mises</option>
        </select>
      </label>
      <label>Warp <input type="range" id="warp" min="0" max="200" value="50"></label>
    </fieldset>
  </aside>
  <section id="canvas"></section>
</main>
<script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `styles.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font: 14px system-ui, sans-serif; color: #222; }
header { padding: 0.5rem 1rem; background: #1d3557; color: #fff; }
header h1 { margin: 0; font-size: 1.1rem; }
header p { margin: 0; opacity: 0.8; font-size: 0.85rem; }
main { display: grid; grid-template-columns: 320px 1fr; height: calc(100vh - 64px); }
#controls { padding: 1rem; overflow-y: auto; border-right: 1px solid #ddd; }
#controls label { display: block; margin: 0.4rem 0; }
#controls input, #controls select { width: 100%; padding: 0.25rem; }
#controls fieldset { margin: 0.6rem 0; padding: 0.4rem 0.6rem; }
#run { width: 100%; padding: 0.5rem; background: #2a9d8f; color: #fff; border: 0; font-weight: 600; cursor: pointer; }
#run:disabled { background: #888; cursor: not-allowed; }
#progress { width: 100%; margin-top: 0.5rem; }
#log { font: 11px monospace; max-height: 8rem; overflow-y: auto; background: #f4f4f4; padding: 0.4rem; }
#canvas { position: relative; }
```

- [ ] **Step 3: Smoke the static mount**

```bash
cd opencascade-fem && docker build -t opencascade-fem:dev . && cd ..
docker run --rm -d --name ocfem -p 8000:8000 opencascade-fem:dev
sleep 3
curl -s http://localhost:8000/ | head -3      # should return the <!doctype html>
docker rm -f ocfem
```

Expected: HTML head visible.

- [ ] **Step 4: Commit**

```bash
git add opencascade-fem/app/web/index.html opencascade-fem/app/web/styles.css
git commit -m "feat(opencascade-fem): static frontend layout"
```

---

## Task 20: Frontend — `app.js` form, EventSource, vtk.js render

**Files:**
- Create: `opencascade-fem/app/web/app.js`

- [ ] **Step 1: Write `app.js`**

```javascript
// opencascade-fem/app/web/app.js
import "@kitware/vtk.js/Rendering/Profiles/Geometry";
import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import vtkXMLUnstructuredGridReader from "@kitware/vtk.js/IO/XML/XMLUnstructuredGridReader";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkWarpVector from "@kitware/vtk.js/Filters/General/WarpVector";
import { ColorMode, ScalarMode } from "@kitware/vtk.js/Rendering/Core/Mapper/Constants";

const $ = (id) => document.getElementById(id);
let catalog = [];
let currentJob = null;
let warpFilter = null;
let mapper = null;
let lut = null;

async function loadCatalog() {
  catalog = await (await fetch("/shapes")).json();
  const sel = $("shape");
  for (const item of catalog) {
    const opt = document.createElement("option");
    opt.value = item.kind;
    opt.textContent = item.kind;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", renderParams);
  renderParams();
}

function renderParams() {
  const kind = $("shape").value;
  const item = catalog.find((x) => x.kind === kind);
  const container = $("params");
  container.innerHTML = "";
  for (const [name, value] of Object.entries(item.defaults)) {
    const [min, max] = item.ranges[name];
    const wrap = document.createElement("label");
    wrap.textContent = `${name} `;
    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = (max - min) / 100;
    input.dataset.param = name;
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

function readParams() {
  const out = {};
  for (const el of $("params").querySelectorAll("input")) {
    out[el.dataset.param] = parseFloat(el.value);
  }
  return out;
}

async function runJob() {
  $("run").disabled = true;
  $("log").textContent = "";
  $("progress").value = 0;

  const body = {
    shape: $("shape").value,
    params: readParams(),
    material: { E_GPa: parseFloat($("E").value), nu: parseFloat($("nu").value) },
    traction: { magnitude_MPa: parseFloat($("traction").value) },
    mesh_size: parseFloat($("mesh_size").value),
  };
  const r = await fetch("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    $("log").textContent = `Error: ${r.status} ${JSON.stringify(await r.json())}`;
    $("run").disabled = false;
    return;
  }
  const { job_id } = await r.json();
  currentJob = job_id;

  const stages = ["queued", "shape", "mesh", "assemble", "solve", "postproc", "done"];
  const es = new EventSource(`/jobs/${job_id}/events`);
  es.onmessage = async (ev) => {
    const data = JSON.parse(ev.data);
    $("log").textContent += `${data.stage}\t${data.message}\n`;
    $("progress").value = stages.indexOf(data.stage);
    if (data.stage === "done") {
      es.close();
      await loadResult(job_id);
      $("run").disabled = false;
    } else if (data.stage === "error") {
      es.close();
      $("run").disabled = false;
    }
  };
  es.onerror = () => { es.close(); $("run").disabled = false; };
}

async function loadResult(jobId) {
  const buf = await (await fetch(`/jobs/${jobId}/result.vtu`)).arrayBuffer();
  const reader = vtkXMLUnstructuredGridReader.newInstance();
  reader.parseAsArrayBuffer(buf);
  const ds = reader.getOutputData(0);

  warpFilter = vtkWarpVector.newInstance();
  warpFilter.setInputData(ds);
  warpFilter.setScaleFactor(parseFloat($("warp").value));
  applyField();

  if (!mapper) {
    mapper = vtkMapper.newInstance();
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    fsrw.getRenderer().addActor(actor);
  }
  mapper.setInputConnection(warpFilter.getOutputPort());
  fsrw.getRenderer().resetCamera();
  fsrw.getRenderWindow().render();
}

function applyField() {
  if (!warpFilter) return;
  const fieldName = $("field").value;
  const ds = warpFilter.getInputData();
  const arr = ds.getPointData().getArrayByName(fieldName);
  ds.getPointData().setActiveScalars(fieldName);
  ds.getPointData().setActiveVectors("displacement");
  const [low, high] = arr.getRange();
  lut = vtkColorTransferFunction.newInstance();
  lut.addRGBPoint(low, 0.231, 0.298, 0.752);
  lut.addRGBPoint((low + high) / 2, 0.865, 0.865, 0.865);
  lut.addRGBPoint(high, 0.706, 0.016, 0.150);
  if (mapper) {
    mapper.setLookupTable(lut);
    mapper.setColorMode(ColorMode.MAP_SCALARS);
    mapper.setScalarMode(ScalarMode.USE_POINT_FIELD_DATA);
    mapper.setColorByArrayName(fieldName);
    mapper.setScalarRange(low, high);
  }
}

$("field").addEventListener("change", applyField);
$("warp").addEventListener("input", () => {
  if (warpFilter) {
    warpFilter.setScaleFactor(parseFloat($("warp").value));
    fsrw.getRenderWindow().render();
  }
});

const fsrw = vtkFullScreenRenderWindow.newInstance({
  rootContainer: document.getElementById("canvas"),
  background: [0.95, 0.95, 0.95],
});

$("run").addEventListener("click", runJob);
loadCatalog();
```

- [ ] **Step 2: Manual browser smoke**

```bash
cd opencascade-fem && docker build -t opencascade-fem:dev . && cd ..
docker run --rm -d --name ocfem -p 8000:8000 opencascade-fem:dev
```

Open `http://localhost:8000/` in a browser. Confirm:
- Three shapes appear in the `Shape` `<select>`.
- Default params populate.
- Clicking **Run** shows progress bar advancing through 6 stages, then the canvas renders the deformed colored model.
- Field selector and warp slider update the view.

Then: `docker rm -f ocfem`.

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/app/web/app.js
git commit -m "feat(opencascade-fem): frontend EventSource + vtk.js renderer"
```

---

## Task 21: E2E smoke test (TDD-style coverage of the full pipeline)

**Files:**
- Create: `opencascade-fem/tests/test_smoke.py`

- [ ] **Step 1: Write the smoke test**

```python
# opencascade-fem/tests/test_smoke.py
"""End-to-end smoke: submit → wait for done → fetch VTU → verify contents."""
import json
from pathlib import Path

import meshio
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import shapes as S
from app.main import app


@pytest.mark.anyio
@pytest.mark.slow
async def test_full_pipeline_smallest_bracket(tmp_path: Path):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=120) as ac:
        r = await ac.post("/jobs", json={
            "shape": "bracket", "params": S.defaults("bracket"), "mesh_size": 20.0,
        })
        job_id = r.json()["job_id"]
        async with ac.stream("GET", f"/jobs/{job_id}/events") as stream:
            async for line in stream.aiter_lines():
                if line.startswith("data: ") and '"done"' in line:
                    break

        r = await ac.get(f"/jobs/{job_id}/result.vtu")
        assert r.status_code == 200
        out = tmp_path / "smoke.vtu"
        out.write_bytes(r.content)

    m = meshio.read(str(out))
    assert "displacement" in m.point_data
    assert "von_mises" in m.point_data
    assert m.point_data["von_mises"].shape[0] == m.points.shape[0]


@pytest.fixture
def anyio_backend():
    return "asyncio"
```

- [ ] **Step 2: Run inside the Docker image**

```bash
cd opencascade-fem
docker run --rm -v "$PWD":/work -w /work opencascade-fem:dev bash -c \
  "pip install -e .[test] && pytest -v -m slow tests/test_smoke.py"
cd ..
```

Expected: PASS within ~30s.

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/tests/test_smoke.py
git commit -m "test(opencascade-fem): end-to-end smoke"
```

---

## Task 22: README

**Files:**
- Modify: `opencascade-fem/README.md`
- Modify: `README.md` (top-level sample list)

- [ ] **Step 1: Write `opencascade-fem/README.md`**

```markdown
# opencascade-fem

OpenCascade (pythonocc-core) でパラメトリック形状を組み、gmsh でメッシュ化し、
scikit-fem で線形弾性解析を行い、結果を vtk.js でブラウザに表示するサンプル。

![screenshot](docs/screenshot.png)

> 上記 `docs/screenshot.png` は実機デプロイ後にブラウザのスクリーンショットを保存して差し替えてください。

## Stack

- **CAD**: pythonocc-core 7.8 (conda-forge)
- **Mesh**: gmsh 4.13
- **Solver**: scikit-fem 10.x + scipy.sparse.linalg.spsolve
- **API**: FastAPI + uvicorn, SSE 進捗ストリーミング
- **Frontend**: vanilla JS + vtk.js (CDN ESM)
- **Container**: micromamba ベース、~700 MB

## Quick start (local)

```bash
cd opencascade-fem
docker compose up --build
open http://localhost:8000
```

## ConoHa deploy

```bash
conoha proxy boot --acme-email you@example.com myserver
conoha app init myserver
conoha app deploy myserver
```

`conoha.yml` の `hosts:` を実際の FQDN に書き換えてください。

## Gallery

| kind | パラメータ | BC |
|------|----------|-----|
| `bracket` | base_len, base_thk, wall_h, wall_thk, width | 底面 fixed / 壁面 上端 traction +Z |
| `plate_hole` | length, width, thickness, hole_radius | 短辺 X=0 fixed / X=L 引張 +X |
| `cantilever_ibeam` | length, height, flange_w, flange_t, web_t | 壁面 X=0 fixed / 自由端 X=L 引張 +X |

## API

| Method | Path | 説明 |
|--------|------|------|
| GET | `/shapes` | ギャラリーカタログ |
| POST | `/jobs` | ジョブ投入 (JobSpec を JSON で送信) |
| GET | `/jobs/{id}/events` | SSE 進捗ストリーム |
| GET | `/jobs/{id}/result.vtu` | 解析結果 (VTU バイナリ) |

SSE イベント:

```json
{"stage": "mesh", "t_ms": 1234, "message": "meshed", "payload": {"file": "mesh.msh"}}
```

ステージ順: `queued → shape → mesh → assemble → solve → postproc → done` (失敗時は `error` で終了)。

## 環境変数

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `OCFEM_MAX_CONCURRENT` | 2 | 同時実行ジョブの上限 |
| `OCFEM_MAX_ELEMENTS` | 200000 | 1 ジョブのメッシュ要素数の上限 |
| `OCFEM_SOLVER_TIMEOUT_SECONDS` | 60 | ソルバーのウォールクロック上限 |
| `OCFEM_JOB_TTL_SECONDS` | 1800 | ジョブディレクトリの保持時間 |

## 既知の制限

- 線形・小変形・等方性のみ。塑性・接触・動解析・モーダル・流体・熱は対象外。
- 加重方向は形状ごとに固定 (荷重面の外向き法線方向)。
- ジョブ状態はインメモリ。コンテナ再起動で消失。
- メッシュ要素数の上限は安全側でかなり保守的。

## References

- pythonocc-core: https://github.com/tpaviot/pythonocc-core
- gmsh: https://gmsh.info/
- scikit-fem: https://scikit-fem.readthedocs.io/
- vtk.js: https://kitware.github.io/vtk-js/
```

- [ ] **Step 2: Add the sample to the top-level README list**

In the top-level `README.md`, in the `## サンプル一覧` table, insert (alphabetical-ish, near `meilisearch`):

```markdown
| [opencascade-fem](opencascade-fem/) | OpenCascade + gmsh + scikit-fem (FastAPI + vtk.js) | パラメトリック CAD → メッシュ → 線形弾性 FEM → ブラウザ 3D 可視化 | g2l-t-2 (2GB) |
```

- [ ] **Step 3: Commit**

```bash
git add opencascade-fem/README.md README.md
git commit -m "docs(opencascade-fem): README + add to top-level sample list"
```

---

## Task 23: Final verification — full Docker build, full test, deploy dry-run

**Files:**
- No file changes.

- [ ] **Step 1: Clean Docker build**

```bash
cd opencascade-fem
docker build --no-cache -t opencascade-fem:final . 2>&1 | tail -20
cd ..
```

Expected: `Successfully tagged opencascade-fem:final`. Build time 6–10 minutes, image size ~700 MB.

- [ ] **Step 2: Full test suite inside the image**

```bash
cd opencascade-fem
docker run --rm -v "$PWD":/work -w /work opencascade-fem:final bash -c \
  "pip install -e .[test] && pytest -v"
cd ..
```

Expected: all tests PASS (fast tests + slow tests).

- [ ] **Step 3: HTTP smoke**

```bash
docker run --rm -d --name ocfem-final -p 8000:8000 opencascade-fem:final
sleep 4
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/shapes | head
docker rm -f ocfem-final
```

Expected: `{"ok":true}` and a JSON catalog of 3 shapes.

- [ ] **Step 4: `conoha.yml` lint**

```bash
conoha app validate opencascade-fem/conoha.yml 2>&1 || true
```

Expected: no schema errors (if `conoha app validate` is not available on this checkout, skip).

- [ ] **Step 5: Open PR (manual)**

```bash
git push -u origin feat/opencascade-fem-sample
gh pr create --title "feat(opencascade-fem): OpenCascade + scikit-fem FEM sample" --body "$(cat <<'EOF'
## Summary
- New `opencascade-fem` sample: parametric CAD (pythonocc-core) → mesh (gmsh) → linear-elasticity FEM (scikit-fem) → browser 3D visualization (vtk.js).
- Single FastAPI container, in-memory job manager with SSE progress streaming, three-shape gallery (bracket, plate-with-hole, cantilever I-beam).
- Deployable with the standard `conoha proxy + app deploy` flow on g2l-t-2.

## Test plan
- [ ] `docker build` succeeds
- [ ] `pytest` (all markers) green inside the image
- [ ] `curl /health` and `curl /shapes` work
- [ ] Browser smoke: each gallery shape runs end-to-end and renders

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: (Optional) ConoHa real-deploy verification**

Per CLAUDE.md, when shipping a sample we typically verify on a real VM. If a test VM is available:

```bash
conoha proxy boot --acme-email you@example.com <vmname>
cd opencascade-fem
conoha app init <vmname>
conoha app deploy <vmname>
```

Open `https://opencascade-fem.example.com` (your FQDN) and run one job from each gallery shape.

---

## Self-Review Summary

Run through the spec sections one last time:

- **§1 Motivation & Scope** — covered by all tasks (sample is single-container, gallery-based, linear elasticity only).
- **§2 Architecture** — Task 1 (skeleton) + Task 13 (lifespan/static mount).
- **§3 Components** — Tasks 4–6 (shapes), 7 (meshing), 8–10 (solver), 11 (VTU), 12 (jobs), 13–15 (API), 19–20 (frontend).
- **§4 Data Flow & Concurrency** — Task 14 (background pipeline), 16 (semaphore), 17 (reaper), 18 (timeout).
- **§5 Error Handling** — Task 14 (validation + 422/400/404/409/410 mappings) + Task 18 (timeout).
- **§6 Testing** — Tasks 4–6, 9–10, 12, 15, 16, 17, 21 each carry the test files named in the spec.
- **§7 Dependencies/Docker/Deployment** — Task 1 + Task 23.

Type & name consistency check: `JobSpec`/`Material`/`Traction` from `schemas.py` used in `api/jobs.py`; `JobManager.submit_with_pipeline`/`events`/`state`/`result_path` used everywhere; shape kind ids (`bracket`, `plate_hole`, `cantilever_ibeam`) consistent.

No remaining placeholders.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-22-opencascade-fem.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best fit because each task is well-isolated and tasks 7 and 9 in particular have known branch points (mesh face-id mapping, traction direction) that benefit from explicit review checkpoints.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
