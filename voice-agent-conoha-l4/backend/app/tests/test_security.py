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

    @app.get("/api/orders/recent")
    def fake_recent():
        return {"orders": []}

    @app.get("/api/orders/{order_id}")
    def fake_get_order(order_id: str):
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


def test_orders_recent_get_rate_limit(client):
    """GET /api/orders/recent shares the same bucket — scrapers get throttled."""
    h = {"origin": "https://allowed.example.com", "x-forwarded-for": "2.3.4.5"}
    assert client.get("/api/orders/recent", headers=h).status_code == 200
    assert client.get("/api/orders/recent", headers=h).status_code == 200
    assert client.get("/api/orders/recent", headers=h).status_code == 200
    assert client.get("/api/orders/recent", headers=h).status_code == 429


def test_other_orders_get_not_rate_limited(client):
    """GET on other /api/orders/* paths (e.g. /{id}) is NOT rate-limited."""
    h = {"origin": "https://allowed.example.com", "x-forwarded-for": "3.4.5.6"}
    for _ in range(5):
        assert client.get("/api/orders/ord_abc123", headers=h).status_code == 200
