from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.database import engine
from app.models import Base
from app.routers import checkout, subscription, webhooks
from app.services.stripe_service import init_price_to_plan


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    init_price_to_plan()
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(webhooks.router)
app.include_router(checkout.router)
app.include_router(subscription.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
