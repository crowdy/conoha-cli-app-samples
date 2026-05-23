# opencascade-fem sample — Design

**Date**: 2026-05-22
**Status**: Draft (awaiting user review)
**Target flavor**: g2l-t-2 (2 vCPU / 2 GB)
**Target slot**: `conoha-cli-app-samples/opencascade-fem/`

## 1. Motivation & Scope

`conoha-cli-app-samples` already covers CFD via four `slurm-rest-api` workloads (Sod shock, lid cavity, LBM cylinder, Rayleigh–Bénard). All four use structured grids on analytical domains and are exercised through the Slurm CLI/batch path.

This sample adds the missing slice: an **end-to-end CAD → mesh → FEM → web visualization** demo, single-container, browser-driven, deployable through the standard `conoha proxy + app deploy` flow. The differentiator is the OpenCascade parametric geometry → gmsh meshing → FEM solver pipeline, exposed as an interactive web app rather than a batch workload.

The sample is **not** a Slurm extension and does not depend on slurm-rest-api.

### Physics in scope

Linear static elasticity. Small deformation, isotropic material (E, ν), Dirichlet (fixed faces) + Neumann (traction) BCs. Output: displacement vector field + nodal von Mises scalar field.

Out of scope: nonlinear/large deformation, contact, dynamics, plasticity, modal/eigenvalue, fluid, thermal, multi-physics.

### Input mode

Curated gallery of three parametric shapes plus per-shape parameter forms. No STEP/IGES upload (out of scope to keep VPS-resource behavior predictable).

### Architecture mode

Single Docker container with FastAPI hosting both API and static frontend. In-memory job queue with `BackgroundTasks` + SSE progress streaming. No Redis, no separate frontend service.

## 2. Architecture Overview

```
┌─ conoha proxy (Caddy, HTTPS termination) ─────────┐
│  https://opencascade-fem.example.com              │
└────────────┬──────────────────────────────────────┘
             │ HTTP → expose: 8000
┌────────────▼──────────────────────────────────────┐
│  Docker: opencascade-fem (FastAPI + uvicorn)      │
│                                                   │
│  app/web/   static assets (index.html + vtk.js)   │
│  app/api/   FastAPI routers                       │
│  app/core/  domain modules                        │
└───────────────────────────────────────────────────┘
        /tmp/jobs/<id>/   per-job working dir
```

### `conoha.yml`

```yaml
name: opencascade-fem
hosts:
  - opencascade-fem.example.com
web:
  service: web
  port: 8000
```

## 3. Components

### Backend core (`app/core/`)

| Module | Responsibility | Key interface |
|---|---|---|
| `shapes.py` | Parametrically build one of 3 gallery shapes via pythonocc-core and return a `TopoDS_Shape` plus a face-ID map for boundary conditions. | `build(kind, params) -> (shape, FaceTags)` where `FaceTags = {"fixed": [face_id], "load": [face_id]}` |
| `meshing.py` | Export OCC shape to a temp STEP file, import into gmsh, tag the fixed/load faces as Physical Groups, write tetrahedral MSH. | `mesh(shape, face_tags, size) -> Path(msh)` |
| `solver.py` | Load MSH via meshio, build scikit-fem `MeshTet` + `ElementVectorH1`, assemble linear elasticity K/F, apply Dirichlet (fixed) + Neumann (traction), solve with scipy `spsolve`, compute nodal von Mises by cell-to-node averaging. | `solve(msh_path, material, traction) -> Result(displacement, von_mises)` |
| `vtu.py` | Serialize mesh + point data (`displacement`, `von_mises`) to a single VTU via meshio. | `write(result, mesh, path)` |
| `jobs.py` | In-memory `dict[job_id, JobState]` + per-job `asyncio.Queue` for SSE events. Submit places job in background task; each pipeline stage emits an event before/after. | `submit(spec) -> job_id`<br>`events(job_id) -> AsyncIterator[Event]`<br>`result_path(job_id) -> Path` |

### Gallery (3 shapes, mm units)

Shape kind identifiers used in the API and persisted catalog:

- `bracket` — L-shaped reinforced bracket. Base face fixed; vertical face tip loaded.
- `plate_hole` — Rectangular plate with a central circular hole. One short edge fixed; opposite edge loaded in tension. Classic stress-concentration demo (K≈3 for Kirsch).
- `cantilever_ibeam` — Simple I-section beam. Wall face fixed; free end loaded transversely.

Each shape exposes a `params` schema (e.g. `Plate{width, height, thickness, hole_radius}`) with explicit min/max ranges. Defaults serve as the demo-friendly starting point.

### API routes (`app/api/`)

```
POST   /jobs                  body schema below → 201 {job_id}
GET    /jobs/{id}/events      text/event-stream — JSON events {stage, t_ms, message, payload?}
GET    /jobs/{id}/result.vtu  200 binary VTU, or 409 (not_ready) / 404 (no job) / 410 (failed)
GET    /shapes                JSON catalog: {kind, defaults, param_ranges} for each gallery item
```

`POST /jobs` body schema (Pydantic):

```jsonc
{
  "shape": "bracket" | "plate_hole" | "cantilever_ibeam",
  "params": { /* shape-specific dimensions, validated against /shapes ranges */ },
  "material": { "E_GPa": 200.0, "nu": 0.3 },
  "traction": { "magnitude_MPa": 10.0 },   // direction is fixed per shape gallery entry
  "mesh_size": 5.0                         // characteristic mesh edge length, mm
}
```

Static frontend served via `app.mount("/", StaticFiles(directory="app/web", html=True))`.

### Frontend (`app/web/`, vanilla JS)

- `index.html` — left panel: shape `<select>`, parameter sliders, material (E/ν), traction magnitude, mesh size, Run button, progress bar; right panel: vtk.js canvas.
- `app.js`:
  1. Submit form → `POST /jobs` → `job_id`.
  2. `new EventSource('/jobs/{id}/events')` → update progress bar per stage.
  3. On `postproc` event with `result_url` payload → `fetch` VTU as `ArrayBuffer` → `vtkXMLUnstructuredGridReader` → `vtkActor` with LUT (viridis).
  4. Side widgets: field selector (displacement magnitude / von Mises) + warp-scale slider.
- Dependency: vtk.js loaded as a single ESM bundle from `@kitware/vtk.js` CDN. No build step.

### Job event sequence

```
queued → shape → mesh → assemble → solve → postproc → done
         ↘────────┴────────┴───────────┴────────┴──────→ error
```

Every event is `{stage, t_ms, message, payload?}` JSON. `payload` example for `mesh`: `{nodes, cells}`; for `postproc`: `{result_url}`.

### Directory layout

```
opencascade-fem/
├── conoha.yml
├── compose.yml
├── Dockerfile
├── environment.yml
├── pyproject.toml
├── README.md
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── jobs.py
│   │   └── shapes.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── shapes.py
│   │   ├── meshing.py
│   │   ├── solver.py
│   │   ├── vtu.py
│   │   └── jobs.py
│   └── web/
│       ├── index.html
│       ├── app.js
│       └── styles.css
└── tests/
    ├── test_shapes.py
    ├── test_meshing.py
    ├── test_solver.py
    ├── test_solver_plate.py
    ├── test_jobs.py
    ├── test_api.py
    └── test_smoke.py
```

## 4. Data Flow & Concurrency

### Single-job sequence

```
Browser              FastAPI              BackgroundTask        /tmp/jobs/{id}
  │ POST /jobs ────────▶│                       │
  │                     │ jobs.submit() ───────▶│ mkdir
  │ ◀── 201 {job_id} ───│                       │
  │ GET events (SSE) ──▶│                       │
  │                     │                       │── shape (OCC)
  │ ◀── stage:shape ────│ ◀───── event ─────────│
  │                     │                       │── mesh.msh (gmsh)
  │ ◀── stage:mesh ─────│ ◀───── event ─────────│
  │                     │                       │── K, F (scikit-fem)
  │ ◀── stage:assemble ─│ ◀───── event ─────────│
  │                     │                       │── u (spsolve)
  │ ◀── stage:solve ────│ ◀───── event ─────────│
  │                     │                       │── result.vtu
  │ ◀── stage:postproc ─│ ◀───── event ─────────│
  │   (payload.result_url)
  │ ◀── stage:done ─────│ (SSE close)
  │ GET result.vtu ────▶│ FileResponse
  │ ◀── 200 binary ─────│
  │ vtk.js render
```

### Async model

FastAPI routers are `async def`. CPU-bound stages (OCC build, gmsh mesh, scipy assemble/solve, meshio write) run on the default `loop.run_in_executor` thread pool so SSE delivery is never blocked. Event emission uses `asyncio.Queue.put_nowait` from inside the worker via `loop.call_soon_threadsafe`.

### Late SSE subscribers

The per-job queue is backed by a `deque(maxlen=32)` of already-emitted events. On connect, the SSE handler flushes the buffered events first, then switches to live. No `last-event-id` / reconnect logic (out of scope for demo).

### Concurrency policy

- `OCFEM_MAX_CONCURRENT=2` semaphore gates simultaneous solves. Excess jobs stay in `queued` until a slot opens.
- `OCFEM_MAX_ELEMENTS=200000` element budget. Estimated element count is computed from shape volume / `mesh_size³` at submit time; jobs over budget are rejected with `400` and an advised `mesh_size`.
- `OCFEM_SOLVER_TIMEOUT_SECONDS=60` per-job wall-clock cap on the solve stage. Exceeded → `error` event with `cause: "timeout"`.
- `OCFEM_JOB_TTL_SECONDS=1800` (30 min). A background reaper task runs every 60s, removing expired job directories. Additional disk guard: if `/tmp/jobs` exceeds 1 GB, the reaper also evicts the oldest jobs regardless of TTL.

### Job lifecycle state machine

```
queued ──▶ shape ──▶ mesh ──▶ assemble ──▶ solve ──▶ postproc ──▶ done
   │         │         │          │           │          │
   └─────────┴─────────┴──────────┴───────────┴──────────┴──▶ error
```

Transitions are one-way; once `error`, the job is terminal.

### File I/O boundary

- `/tmp/jobs/{id}/shape.step` — OCC export → gmsh import bridge.
- `/tmp/jobs/{id}/mesh.msh` — gmsh output.
- `/tmp/jobs/{id}/result.vtu` — final visualizable result.

Each job directory is its job's only persistent state. No cross-job sharing.

## 5. Error Handling

### Error classification

| Stage | Example cause | Response | SSE stage |
|---|---|---|---|
| API validation (pre-submit) | unknown shape, params out of range, mesh_size 0, negative magnitude | `400` Pydantic error (job not created) | — |
| `shape` | OCC BRep failure (e.g. `hole_radius >= plate_width/2`) | event `error` | `error` |
| `mesh` | gmsh failure, element budget overrun, zero-volume region | event `error` (`payload.advice` with recommended mesh_size) | `error` |
| `assemble` | degenerate Jacobian, insufficient DOFs | event `error` | `error` |
| `solve` | scipy `MatrixRankWarning` / singular matrix / 60s timeout | event `error` (`payload.cause`: `singular` or `timeout`) | `error` |
| `postproc` | meshio serialization failure | event `error` | `error` |
| HTTP fetch | `result.vtu` requested while job in-flight | `409 not_ready`; `404` for unknown job; `410 failed` for terminal error | — |

### Principles

- Validate as early as possible (router). Inputs that cannot be made valid never become a job.
- Any background exception is signaled by exactly one `error` SSE event, and the job is terminal. Subsequent `result.vtu` GETs return `410`.
- Backend tracebacks are never exposed to the client. Users see only a `cause` category and a short remediation hint (e.g. "Mesh too large; try mesh_size ≥ 5.0"). Backend logs retain the traceback for operators.

## 6. Testing

| Test file | What it covers | Approx. cost |
|---|---|---|
| `test_shapes.py` | Each of 3 shapes builds with `Volume>0`, BC face IDs are valid face indices, boundary-range params still build. | <1s each |
| `test_meshing.py` | OCC→STEP→gmsh path produces MSH with non-empty tet cell block and the `fixed`/`load` Physical Groups present. | 1–2s |
| `test_solver.py` | **Analytic benchmark — cantilever tip deflection** `δ = FL³/(3EI)` agrees within 5% on a sufficiently fine mesh. Primary regression net. | 5–10s |
| `test_solver_plate.py` | Plate-with-hole: hole-edge stress concentration `K ≈ 3` (Kirsch) within ±20% (mesh-dependent). | 5–10s |
| `test_jobs.py` | Job lifecycle: submit → events fire in `shape < mesh < assemble < solve < postproc < done` order; semaphore enforces concurrency; reaper deletes expired dirs. | 5s |
| `test_api.py` | httpx + ASGITransport: `POST /jobs` validation, `/events` SSE text parsing, `/result.vtu` content-type + headers, `409`/`404`/`410` cases. | 3–5s |
| `test_smoke.py` | E2E one job (smallest plate). VTU is valid XML and `point_data` has `displacement` and `von_mises`. Marked `@pytest.mark.slow`. | 15–20s |

CI follows existing repo pattern (`slurm-rest-api/tests/`): pytest run inside the built Docker image; `not slow` by default.

### Test-driven candidates

- `solver` analytic benchmarks (cantilever, plate) — expected values known, TDD applies cleanly.
- API validation and error paths — schema and HTTP responses are spec-defined; TDD applies.
- Meshing and jobs lifecycle — write tests after first-cut behavior is observed (regression nets, not specs).

## 7. Dependencies, Docker, Deployment

### `environment.yml`

```yaml
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

Test deps (`pytest`, `httpx`, `asgi-lifespan`) live in `pyproject.toml` under `[project.optional-dependencies] test` and are not installed in the production image.

**Why conda over pip**: `pythonocc-core` is not published on PyPI. conda-forge is the only ABI-correct distribution channel for it together with `opencascade-occt`. Mixing with pip for pure-Python deps is standard.

### Dockerfile

```dockerfile
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

Estimated image size: ~700 MB (occt + pythonocc-core ~250 MB, gmsh ~150 MB, conda base + remaining deps ~300 MB). Comparable to `vllm-gpu` / `hunyuan3d-gpu`.

### `compose.yml`

```yaml
services:
  web:
    build: .
    expose: ["8000"]
    environment:
      OCFEM_MAX_CONCURRENT: "2"
      OCFEM_MAX_ELEMENTS: "200000"
      OCFEM_JOB_TTL_SECONDS: "1800"
    volumes:
      - jobs:/tmp/jobs
volumes:
  jobs: {}
```

### Flavor & expected timing

`g2l-t-2` (2 vCPU / 2 GB). Per-job wall-clock estimate at default params:

| Stage | Expected |
|---|---|
| shape | <0.1s |
| mesh | 1–3s |
| assemble | ~1s |
| solve (spsolve, ~5–20k DOFs) | 0.5–3s |
| postproc | ~0.2s |
| **total** | **5–8s** |

First image build on a ConoHa node: ~6–8 minutes.

### README outline (matching other samples)

1. One-line description + screenshot.
2. Quick start (local `docker compose up` → http://localhost:8000).
3. ConoHa deploy (`proxy boot` → `app init` → `app deploy`).
4. Gallery table (3 shapes, param ranges).
5. API reference (4 endpoints + SSE event schema).
6. Resource limits / env vars.
7. Known limits (linear static + small deformation; 200k element cap; jobs are volatile across restarts).
8. References (pythonocc-core, scikit-fem, vtk.js).

### Blog post

Out of scope for this design. Existing GPU/CFD samples have been followed by Qiita posts after the sample lands; the same flow can apply here separately.

## 8. Open Questions

None blocking. The design has been brainstormed section by section; all major decisions are recorded above.

## 9. Next Step

Once this spec is approved by the user, invoke the `writing-plans` skill to produce an implementation plan. The plan will be executed via the `executing-plans` / `subagent-driven-development` flow.
