from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import settings
from app.broadcast import BroadcastHub
from app.routers import events, orders, realtime
from app.sheets import SheetsClient
from app.store import OrderStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tests pre-seed app.state before entering the TestClient context,
    # so only create real dependencies when they are missing.
    if not hasattr(app.state, "sheets"):
        app.state.sheets = SheetsClient(
            settings.GOOGLE_APPLICATION_CREDENTIALS_JSON, settings.SHEET_ID
        )
    if not hasattr(app.state, "hub"):
        app.state.hub = BroadcastHub()
    if not hasattr(app.state, "store"):
        app.state.store = OrderStore()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="voice-agent-webrtc-realtime", lifespan=lifespan)
    app.include_router(realtime.router)
    app.include_router(orders.router)
    app.include_router(events.router)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    return app


app = create_app()
