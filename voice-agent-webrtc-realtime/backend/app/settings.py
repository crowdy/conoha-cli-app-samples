import os

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_REALTIME_MODEL = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2")
GOOGLE_APPLICATION_CREDENTIALS_JSON = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "")
SHEET_ID = os.environ.get("SHEET_ID", "")
RESTAURANT_NAME = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")
