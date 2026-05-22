"""End-to-end smoke: submit → wait for done → fetch VTU → verify contents."""
import json
from pathlib import Path

import meshio
import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.core import shapes as S
from app.main import app


@pytest.mark.anyio
@pytest.mark.slow
async def test_full_pipeline_smallest_bracket(tmp_path: Path):
    transport = ASGITransport(app=app)
    async with LifespanManager(app):
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
