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
