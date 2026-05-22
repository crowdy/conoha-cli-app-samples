import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.shapes import router as shapes_router
from app.api.jobs import router as jobs_router
from app.core.jobs import JobManager
from app.settings import Settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    app.state.settings = settings
    app.state.jobs = JobManager(
        work_root=settings.job_dir, max_concurrent=settings.max_concurrent
    )

    async def reaper():
        while True:
            await asyncio.sleep(60)
            try:
                await app.state.jobs.reap_expired(settings.job_ttl_seconds)
            except Exception:
                pass

    task = asyncio.create_task(reaper())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="opencascade-fem", lifespan=lifespan)
app.include_router(shapes_router)
app.include_router(jobs_router)


@app.get("/health")
@app.get("/up")
def health() -> dict:
    return {"ok": True}


WEB_DIR = Path(__file__).parent / "web"
if WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
