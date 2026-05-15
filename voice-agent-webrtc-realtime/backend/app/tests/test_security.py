"""Origin-guard and per-IP rate-limit middleware tests."""
import pytest

from app import settings


_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"


def _mock_openai_ok(httpx_mock):
    httpx_mock.add_response(
        url=_SESSIONS_URL,
        json={
            "client_secret": {
                "value": "ek_x",
                "expires_at": "2026-05-15T00:01:00Z",
            }
        },
        is_reusable=True,
    )


def test_session_rate_limit_kicks_in(client, httpx_mock, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_RATE_LIMIT_PER_MIN", 2)
    # Rebuild the bucket with the patched value
    from app import security
    security._session_bucket = security._IPBucket(2)

    _mock_openai_ok(httpx_mock)
    assert client.post("/api/realtime/session", json={"mode": "emergency"}).status_code == 200
    assert client.post("/api/realtime/session", json={"mode": "emergency"}).status_code == 200
    assert client.post("/api/realtime/session", json={"mode": "emergency"}).status_code == 429


def test_origin_allowlist_blocks_disallowed(client, monkeypatch):
    # No OpenAI mock — the origin guard must block before any outbound call.
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["https://prod.example.com"])
    res = client.post(
        "/api/realtime/session",
        json={"mode": "emergency"},
        headers={"Origin": "https://evil.example.com"},
    )
    assert res.status_code == 403


def test_origin_allowlist_permits_allowed(client, httpx_mock, monkeypatch):
    _mock_openai_ok(httpx_mock)
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["https://prod.example.com"])
    res = client.post(
        "/api/realtime/session",
        json={"mode": "emergency"},
        headers={"Origin": "https://prod.example.com"},
    )
    assert res.status_code == 200


def test_origin_allowlist_empty_allows_all(client, httpx_mock):
    """Default dev posture: no allowlist configured = all origins OK."""
    _mock_openai_ok(httpx_mock)
    res = client.post("/api/realtime/session", json={"mode": "emergency"})
    assert res.status_code == 200


def test_origin_guard_applies_to_orders_too(client, monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", ["https://prod.example.com"])
    res = client.post(
        "/api/orders",
        json={
            "mode": "callcenter",
            "language": "ja",
            "items": [{"name": "x", "qty": 1}],
        },
        headers={"Origin": "https://evil.example.com"},
    )
    assert res.status_code == 403
