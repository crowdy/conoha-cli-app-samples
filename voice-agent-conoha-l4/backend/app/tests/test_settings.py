# voice-agent-conoha-l4/backend/app/tests/test_settings.py
import importlib
import os


def reload_settings():
    from app import settings
    return importlib.reload(settings)


def test_defaults(monkeypatch):
    for k in ("ALLOWED_ORIGINS", "ORDERS_RATE_LIMIT_PER_MIN", "SHEET_ID",
             "GOOGLE_APPLICATION_CREDENTIALS_JSON", "RESTAURANT_NAME"):
        monkeypatch.delenv(k, raising=False)
    s = reload_settings()
    assert s.ALLOWED_ORIGINS == []
    assert s.ORDERS_RATE_LIMIT_PER_MIN == 30
    assert s.SHEET_ID == ""
    assert s.RESTAURANT_NAME == "カフェ・コノハ"


def test_allowed_origins_parsed(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example.com, https://b.example.com")
    s = reload_settings()
    assert s.ALLOWED_ORIGINS == ["https://a.example.com", "https://b.example.com"]
