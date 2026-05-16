# voice-agent-conoha-l4/backend/app/tests/test_main.py
from unittest.mock import patch

from fastapi.testclient import TestClient


def test_healthz(monkeypatch):
    monkeypatch.setenv("SHEET_ID", "x")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS_JSON", '{"type":"service_account"}')
    with patch("app.main.SheetsClient") as _:
        from app.main import create_app
        app = create_app()
        with TestClient(app) as client:
            assert client.get("/healthz").status_code == 200
            assert client.get("/healthz").json() == {"ok": True}
