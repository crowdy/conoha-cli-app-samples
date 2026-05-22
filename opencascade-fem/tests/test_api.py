import pytest
from asgi_lifespan import LifespanManager
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


@pytest.mark.anyio
async def test_post_jobs_rejects_unknown_shape():
    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post("/jobs", json={
                "shape": "spaceship", "params": {}, "mesh_size": 5.0,
            })
    assert r.status_code == 422


@pytest.mark.anyio
async def test_post_jobs_returns_201_and_job_id_for_valid_bracket():
    from app.core import shapes as S
    async with LifespanManager(app):
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
    from app.core import shapes as S
    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post("/jobs", json={
                "shape": "bracket",
                "params": S.defaults("bracket"),
                "mesh_size": 0.1,
            })
    # Pre-flight element estimate should reject this
    assert r.status_code == 400
    body = r.json()
    assert "advice" in body.get("detail", {})


@pytest.mark.anyio
async def test_events_stream_terminates_with_done_on_short_job():
    from app.core import shapes as S
    transport = ASGITransport(app=app)
    async with LifespanManager(app):
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
                    import json
                    ev = json.loads(line.removeprefix("data: "))
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
    async with LifespanManager(app):
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
            # VTU is XML; either ASCII or binary-with-XML-header
            assert r.content.startswith(b"<?xml") or b"VTKFile" in r.content[:200]


@pytest.mark.anyio
async def test_result_404_for_unknown_job():
    transport = ASGITransport(app=app)
    async with LifespanManager(app):
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/jobs/unknown-id/result.vtu")
            assert r.status_code == 404
