import uuid
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app import settings
from app.personas import PERSONAS
from app.security import OfferRateLimitMiddleware, OriginGuardMiddleware
from app.services.mocks import MockLLM, MockSTT, MockTTS
from app.sessions import SessionRegistry
from app.transport import WebRTCNegotiator


Mode = Literal["emergency", "military", "callcenter"]


class OfferRequest(BaseModel):
    sdp: str
    type: str
    mode: Mode


class OfferResponse(BaseModel):
    sdp: str
    type: str
    session_id: str


def create_app(use_mock_services: bool = False) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sessions = SessionRegistry(max_sessions=settings.MAX_CONCURRENT_SESSIONS)
        app.state.negotiator = WebRTCNegotiator()
        if use_mock_services:
            app.state.stt, app.state.llm, app.state.tts = MockSTT(), MockLLM(), MockTTS()
            app.state.ready = True
        else:
            # Real services wired in Phase D
            app.state.stt = app.state.llm = app.state.tts = None
            app.state.ready = False
        yield
        await app.state.negotiator.close_all()

    app = FastAPI(title="voice-agent-conoha-l4-agent", lifespan=lifespan)
    app.add_middleware(OfferRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)

    @app.get("/healthz")
    async def healthz():
        if not getattr(app.state, "ready", False):
            raise HTTPException(status_code=503, detail="warming up")
        return {"ok": True}

    @app.get("/modes")
    async def modes():
        return {"modes": list(PERSONAS.keys())}

    @app.post("/offer", response_model=OfferResponse)
    async def offer(req: OfferRequest):
        _provisional_id = uuid.uuid4().hex
        if not app.state.sessions.acquire(_provisional_id):
            raise HTTPException(status_code=503, detail="too many sessions")
        try:
            result = await app.state.negotiator.handle_offer(req.sdp, req.type)
        except Exception:
            app.state.sessions.release(_provisional_id)
            raise
        # Replace the provisional reservation with the real session id.
        app.state.sessions.release(_provisional_id)
        app.state.sessions.acquire(result.session_id)
        return OfferResponse(sdp=result.sdp, type=result.type,
                             session_id=result.session_id)

    return app


app = create_app(use_mock_services=False)
