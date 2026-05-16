# voice-agent-conoha-l4/backend/app/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import settings
from app.routers.events import EventBroker
from app.routers.events import router as events_router
from app.routers.orders import router as orders_router
from app.security import OrdersRateLimitMiddleware, OriginGuardMiddleware
from app.sheets import SheetsClient
from app.store import OrderStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.store = OrderStore()
    app.state.broker = EventBroker()
    app.state.sheets = SheetsClient(
        credentials_json=settings.GOOGLE_APPLICATION_CREDENTIALS_JSON,
        sheet_id=settings.SHEET_ID,
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="voice-agent-conoha-l4-backend", lifespan=lifespan)
    app.add_middleware(OrdersRateLimitMiddleware)
    app.add_middleware(OriginGuardMiddleware)
    app.include_router(orders_router)
    app.include_router(events_router)

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    return app


app = create_app()
