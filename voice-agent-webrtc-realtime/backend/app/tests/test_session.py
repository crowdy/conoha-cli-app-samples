import pytest

_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"


@pytest.mark.parametrize(
    "mode,expected_substring",
    [
        ("emergency", "救急センター"),
        ("military", "作戦司令部"),
        ("callcenter", "コールセンター"),
        ("bogus", "コールセンター"),  # unknown mode falls back to callcenter
    ],
)
def test_session_embeds_persona(client, httpx_mock, mode, expected_substring):
    httpx_mock.add_response(
        url=_SESSIONS_URL,
        json={
            "client_secret": {
                "value": "ek_test_123",
                "expires_at": "2026-05-15T00:01:00Z",
            }
        },
    )
    res = client.post("/api/realtime/session", json={"mode": mode})
    assert res.status_code == 200
    body = res.json()
    assert body["client_secret"] == "ek_test_123"
    assert body["expires_at"] == "2026-05-15T00:01:00Z"
    assert expected_substring in body["session"]["instructions"]
    assert body["session"]["turn_detection"] == {"type": "none"}
    assert [t["name"] for t in body["session"]["tools"]] == [
        "add_order",
        "update_order",
        "close_order",
        "list_orders",
    ]


def test_session_openai_error_returns_503(client, httpx_mock):
    httpx_mock.add_response(url=_SESSIONS_URL, status_code=429)
    res = client.post("/api/realtime/session", json={"mode": "emergency"})
    assert res.status_code == 503
