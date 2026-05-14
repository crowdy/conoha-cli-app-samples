from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Real dependencies are attached here in later tasks. Tests pre-seed
    # app.state before entering the TestClient context, so only fill gaps.
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="voice-agent-webrtc-realtime", lifespan=lifespan)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    return app


app = create_app()
