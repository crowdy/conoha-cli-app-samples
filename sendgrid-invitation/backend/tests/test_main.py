from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_invite_success():
    mock_sg = MagicMock()
    mock_response = MagicMock()
    mock_response.status_code = 202
    mock_sg.send.return_value = mock_response

    with patch("app.main.SendGridAPIClient", return_value=mock_sg):
        with patch("app.main.settings") as mock_settings:
            mock_settings.sendgrid_api_key = "test-key"
            mock_settings.from_email = "admin@example.com"
            mock_settings.from_name = "Test Org"
            response = client.post(
                "/api/invite",
                json={
                    "to_email": "member@example.com",
                    "to_name": "田中太郎",
                    "message": "チームに参加してください",
                },
            )
    assert response.status_code == 200
    assert response.json() == {"success": True}


def test_invite_invalid_email():
    response = client.post(
        "/api/invite",
        json={
            "to_email": "not-an-email",
            "to_name": "Test",
            "message": "Hello",
        },
    )
    assert response.status_code == 422
