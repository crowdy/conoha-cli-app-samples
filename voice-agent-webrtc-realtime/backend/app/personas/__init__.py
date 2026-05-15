from pathlib import Path

from app import settings

_DIR = Path(__file__).parent
DEFAULT_MODE = "callcenter"

_RAW = {
    "emergency": (_DIR / "emergency.md").read_text(encoding="utf-8"),
    "military": (_DIR / "military.md").read_text(encoding="utf-8"),
    "callcenter": (_DIR / "callcenter.md").read_text(encoding="utf-8"),
}

# {RESTAURANT_NAME} is substituted once at import time.
PERSONAS = {
    mode: text.replace("{RESTAURANT_NAME}", settings.RESTAURANT_NAME)
    for mode, text in _RAW.items()
}


def resolve(mode: str) -> tuple[str, str]:
    """Return (mode, instructions). Unknown modes fall back to callcenter."""
    if mode not in PERSONAS:
        mode = DEFAULT_MODE
    return mode, PERSONAS[mode]
