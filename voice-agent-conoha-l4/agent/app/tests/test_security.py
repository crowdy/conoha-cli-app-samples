import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security import OfferRateLimitMiddleware, OriginGuardMiddleware, reset_offer_bucket


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://allowed.example.com")
    monkeypatch.setenv("OFFER_RATE_LIMIT_PER_MIN", "2")
    import importlib
    from app import settings
    importlib.reload(settings)
    reset_offer_bucket()

    app = FastAPI()
    app.add_middleware(OfferRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)

    @app.post("/offer")
    def offer():
        return {"ok": True}

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return TestClient(app)


def test_offer_origin_blocked(client):
    assert client.post("/offer", headers={"origin": "https://evil"}).status_code == 403


def test_offer_rate_limit(client):
    h = {"origin": "https://allowed.example.com", "x-forwarded-for": "9.9.9.9"}
    assert client.post("/offer", headers=h).status_code == 200
    assert client.post("/offer", headers=h).status_code == 200
    assert client.post("/offer", headers=h).status_code == 429


def test_healthz_skips_origin_check(client):
    assert client.get("/healthz", headers={"origin": "https://evil"}).status_code == 200
