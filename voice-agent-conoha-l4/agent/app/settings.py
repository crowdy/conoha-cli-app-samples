import os

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8000")
LLM_URL = os.environ.get("LLM_URL", "http://llm:8000/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-7B-Instruct-AWQ")
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "medium")
SBV2_MODEL_DIR = os.environ.get("SBV2_MODEL_DIR", "/models/sbv2")
RESTAURANT_NAME = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

OFFER_RATE_LIMIT_PER_MIN = int(os.environ.get("OFFER_RATE_LIMIT_PER_MIN", "3"))
MAX_CONCURRENT_SESSIONS = int(os.environ.get("MAX_CONCURRENT_SESSIONS", "5"))
SESSION_MAX_DURATION_SEC = int(os.environ.get("SESSION_MAX_DURATION_SEC", "600"))
