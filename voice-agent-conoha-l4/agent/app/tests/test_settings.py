import importlib


def _reload(monkeypatch):
    from app import settings
    return importlib.reload(settings)


def test_defaults(monkeypatch):
    for k in ("BACKEND_URL", "LLM_URL", "LLM_MODEL", "WHISPER_MODEL_SIZE",
              "ALLOWED_ORIGINS", "OFFER_RATE_LIMIT_PER_MIN",
              "MAX_CONCURRENT_SESSIONS", "SESSION_MAX_DURATION_SEC",
              "SBV2_MODEL_DIR", "RESTAURANT_NAME"):
        monkeypatch.delenv(k, raising=False)
    s = _reload(monkeypatch)
    assert s.BACKEND_URL == "http://backend:8000"
    assert s.LLM_URL == "http://llm:8000/v1"
    assert s.LLM_MODEL == "Qwen/Qwen2.5-7B-Instruct-AWQ"
    assert s.WHISPER_MODEL_SIZE == "medium"
    assert s.OFFER_RATE_LIMIT_PER_MIN == 3
    assert s.MAX_CONCURRENT_SESSIONS == 5
    assert s.SESSION_MAX_DURATION_SEC == 600
