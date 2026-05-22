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
