"""FastAPI app for the dns-server sample."""

import os

from fastapi import FastAPI

from api.db import lifespan
from api.routers import health, subdomains, zone

ENV = os.environ.get("ENV", "prod")

app = FastAPI(
    title="dns-server admin API",
    version="0.1.0",
    docs_url="/docs" if ENV == "dev" else None,
    openapi_url="/openapi.json" if ENV == "dev" else None,
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(zone.router)
app.include_router(subdomains.router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "dns-server", "version": "0.1.0"}
