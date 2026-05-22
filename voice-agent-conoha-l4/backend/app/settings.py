# voice-agent-conoha-l4/backend/app/settings.py
import os

GOOGLE_APPLICATION_CREDENTIALS_JSON = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "")
SHEET_ID = os.environ.get("SHEET_ID", "")
RESTAURANT_NAME = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")

ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

ORDERS_RATE_LIMIT_PER_MIN = int(os.environ.get("ORDERS_RATE_LIMIT_PER_MIN", "30"))
