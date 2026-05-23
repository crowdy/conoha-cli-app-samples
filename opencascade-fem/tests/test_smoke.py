"""End-to-end smoke: submit → wait for done → fetch VTP → verify contents."""
import json
import xml.etree.ElementTree as ET
from pathlib import Path

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

            r = await ac.get(f"/jobs/{job_id}/result.vtp")
            assert r.status_code == 200
            out = tmp_path / "smoke.vtp"
            out.write_bytes(r.content)

    # VTP is XML — parse and verify structure without meshio (meshio 5.x lacks .vtp support)
    content = out.read_text(encoding="utf-8")
    assert "VTKFile" in content, "not a VTK XML file"
    assert 'type="PolyData"' in content, "not a PolyData VTP file"

    tree = ET.parse(str(out))
    root = tree.getroot()
    assert root.tag == "VTKFile"
    assert root.attrib.get("type") == "PolyData"

    piece = root.find(".//Piece")
    assert piece is not None
    n_points = int(piece.attrib["NumberOfPoints"])
    n_polys = int(piece.attrib["NumberOfPolys"])
    assert n_points > 0, "no points in VTP"
    assert n_polys > 0, "no polys in VTP"

    # Verify all expected field arrays are present
    array_names = {da.attrib.get("Name", "") for da in root.findall(".//DataArray")}
    assert "displacement" in array_names
    assert "von_mises" in array_names
    assert "displacement_magnitude" in array_names


@pytest.fixture
def anyio_backend():
    return "asyncio"
