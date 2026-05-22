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


@pytest.fixture
def anyio_backend():
    return "asyncio"
