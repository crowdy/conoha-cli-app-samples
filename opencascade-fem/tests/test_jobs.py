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
