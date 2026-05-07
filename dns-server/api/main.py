"""FastAPI app for the dns-server sample.

Routers are mounted in Task 8 once they exist.
"""

import os

from fastapi import FastAPI

ENV = os.environ.get("ENV", "prod")

app = FastAPI(
    title="dns-server admin API",
    version="0.1.0",
    docs_url="/docs" if ENV == "dev" else None,
    openapi_url="/openapi.json" if ENV == "dev" else None,
)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "dns-server", "version": "0.1.0"}
