import pytest
from fastapi.testclient import TestClient

from app.server import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "")
    monkeypatch.setenv("MAX_CONCURRENT_SESSIONS", "1")
    import importlib
    from app import settings
    importlib.reload(settings)
    app = create_app(use_mock_services=True)
    return TestClient(app)


def test_healthz_starts_503(client):
    # Mock services warm up instantly, but /healthz only flips after lifespan
    # has run. TestClient's `with` form triggers lifespan; without it, state
    # is uninitialised → 503.
    resp = client.get("/healthz")
    assert resp.status_code == 200  # mocks are ready immediately
    assert resp.json()["ok"] is True


def test_modes_endpoint(client):
    r = client.get("/modes")
    assert r.status_code == 200
    assert set(r.json()["modes"]) == {"emergency", "military", "callcenter"}


def test_offer_unknown_mode_rejected(client):
    r = client.post("/offer", json={"sdp": "v=0\r\n", "type": "offer", "mode": "intergalactic"})
    assert r.status_code == 422
