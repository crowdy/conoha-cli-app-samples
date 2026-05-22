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
        try:
            result, mesh = await asyncio.wait_for(
                loop.run_in_executor(None, F.solve, msh, mat, spec.traction.magnitude_MPa),
                timeout=settings.solver_timeout_seconds,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(f"solver timeout after {settings.solver_timeout_seconds}s")
        await emit("solve", "solved",
                   payload={"n_dofs": int(result.n_dofs), "walltime_s": float(result.walltime_s)})

        out = work_dir / "result.vtu"
        await loop.run_in_executor(None, V.write, result, mesh, out)
        await emit("postproc", "wrote",
                   payload={"result_url": f"/jobs/{work_dir.name}/result.vtu"})

    job_id = await mgr.submit_with_pipeline(spec.model_dump(), pipeline)
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
