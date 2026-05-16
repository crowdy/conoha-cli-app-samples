# voice-agent-conoha-l4/backend/app/tests/test_security.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security import OriginGuardMiddleware, OrdersRateLimitMiddleware, reset_orders_bucket


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://allowed.example.com")
    monkeypatch.setenv("ORDERS_RATE_LIMIT_PER_MIN", "3")
    import importlib
    from app import settings
    importlib.reload(settings)
    reset_orders_bucket()

    app = FastAPI()
    app.add_middleware(OrdersRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)

    @app.post("/api/orders")
    def fake_orders():
        return {"ok": True}

    @app.get("/")
    def root():
        return {"ok": True}

    return TestClient(app)


def test_origin_allowed(client):
    r = client.post("/api/orders", headers={"origin": "https://allowed.example.com"})
    assert r.status_code == 200


def test_origin_blocked(client):
    r = client.post("/api/orders", headers={"origin": "https://evil.example.com"})
    assert r.status_code == 403


def test_non_api_route_skips_origin_check(client):
    r = client.get("/", headers={"origin": "https://evil.example.com"})
    assert r.status_code == 200


def test_orders_rate_limit(client):
    h = {"origin": "https://allowed.example.com", "x-forwarded-for": "1.2.3.4"}
    assert client.post("/api/orders", headers=h).status_code == 200
    assert client.post("/api/orders", headers=h).status_code == 200
    assert client.post("/api/orders", headers=h).status_code == 200
    assert client.post("/api/orders", headers=h).status_code == 429
