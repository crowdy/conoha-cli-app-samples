import os

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_REALTIME_MODEL = os.environ.get("OPENAI_REALTIME_MODEL", "gpt-realtime-2")
GOOGLE_APPLICATION_CREDENTIALS_JSON = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "")
SHEET_ID = os.environ.get("SHEET_ID", "")
RESTAURANT_NAME = os.environ.get("RESTAURANT_NAME", "カフェ・コノハ")

# Comma-separated allow list. Empty string = allow all (dev/test default).
# In production, set this to your FQDN(s): "https://voice-agent.example.com"
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]

# Max requests per IP per minute against the ephemeral-token endpoint.
# Each minted session can consume real OpenAI quota; this bounds the
# attacker's blast radius on a public deploy.
SESSION_RATE_LIMIT_PER_MIN = int(os.environ.get("SESSION_RATE_LIMIT_PER_MIN", "6"))
