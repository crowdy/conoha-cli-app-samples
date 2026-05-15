import httpx
from fastapi import APIRouter, HTTPException, Request

from app import settings
from app.models import SessionRequest
from app.personas import resolve
from app.security import session_rate_limit
from app.tools_schema import TOOLS

router = APIRouter(prefix="/api/realtime", tags=["realtime"])

_OPENAI_SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions"


@router.post("/session")
async def create_session(req: SessionRequest, request: Request):
    if not session_rate_limit(request):
        raise HTTPException(status_code=429, detail="rate limit exceeded")

    mode, instructions = resolve(req.mode)

    try:
        async with httpx.AsyncClient(timeout=10) as http:
            resp = await http.post(
                _OPENAI_SESSIONS_URL,
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json={"model": settings.OPENAI_REALTIME_MODEL, "voice": "alloy"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="OpenAI unreachable") from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=503, detail="OpenAI session error")

    secret = resp.json()["client_secret"]
    return {
        "client_secret": secret["value"],
        "expires_at": secret["expires_at"],
        "model": settings.OPENAI_REALTIME_MODEL,
        "session": {
            "instructions": instructions,
            "voice": "alloy",
            "input_audio_transcription": {"model": "whisper-1"},
            "turn_detection": {"type": "none"},
            "tools": TOOLS,
        },
    }
