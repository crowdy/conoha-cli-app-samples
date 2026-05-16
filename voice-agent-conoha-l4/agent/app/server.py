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
        app.state.ready = False
        if use_mock_services:
            app.state.stt, app.state.llm, app.state.tts = MockSTT(), MockLLM(), MockTTS()
            app.state.ready = True
        else:
            from app.services.llm import VLLMService
            from app.services.stt import WhisperSTTService
            from app.services.tts import SBV2TTSService
            app.state.stt = WhisperSTTService(model_size=settings.WHISPER_MODEL_SIZE)
            app.state.llm = VLLMService(base_url=settings.LLM_URL, model=settings.LLM_MODEL)
            app.state.tts = SBV2TTSService(model_dir=settings.SBV2_MODEL_DIR)
            # Best-effort warmup. /healthz remains 503 if any of these throws.
            try:
                await app.state.stt.transcribe(b"\x00" * 1600)  # 100ms silence @16k
                await app.state.llm.chat(
                    messages=[{"role": "user", "content": "warmup"}],
                    tools=[], tool_choice="none",
                )
                await app.state.tts.synthesize("起動完了", language="ja")
                app.state.ready = True
            except Exception:
                import logging
                logging.exception("warmup failed")
                app.state.ready = False

        def services_factory():
            return app.state.stt, app.state.llm, app.state.tts

        app.state.negotiator = WebRTCNegotiator(
            services_factory=services_factory,
            release_cb=app.state.sessions.release,
        )
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
        if not app.state.ready:
            raise HTTPException(status_code=503, detail="warming up")
        _provisional_id = uuid.uuid4().hex
        if not app.state.sessions.acquire(_provisional_id):
            raise HTTPException(status_code=503, detail="too many sessions")
        try:
            result = await app.state.negotiator.handle_offer(req.sdp, req.type, req.mode)
        except Exception:
            app.state.sessions.release(_provisional_id)
            raise
        if not app.state.sessions.rename(_provisional_id, result.session_id):
            # Slot was released externally — extremely unlikely. Bail out cleanly.
            await app.state.negotiator.close(result.session_id)
            raise HTTPException(status_code=500, detail="session registry race")
        return OfferResponse(sdp=result.sdp, type=result.type,
                             session_id=result.session_id)

    return app


app = create_app(use_mock_services=False)
