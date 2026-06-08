import asyncio
import contextlib
import logging
from pathlib import Path

import aiohttp
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from kubernetes.client.exceptions import ApiException
from pydantic import BaseModel, field_validator

from app.console import SUBPROTOCOL, console_ws_url, pump
from app.manifest import validate_name
from app.vms import CapExceeded, VMStore

app = FastAPI(title="kubevirt-provisioner")

logger = logging.getLogger("kubevirt_provisioner.console")
_STATIC_DIR = Path(__file__).parent / "static"

# Populated at startup in a later task. Tests override get_store().
_store: VMStore | None = None


def get_store() -> VMStore:
    if _store is None:
        raise HTTPException(status_code=503, detail="cluster not ready")
    return _store


@contextlib.contextmanager
def _translate_404():
    """Map a kube 404 ApiException to an HTTP 404."""
    try:
        yield
    except ApiException as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="not found")
        raise


# Replaced at startup with a real cluster-backed callable in a later task. Default
# returns "not ready" so the route is safe before the cluster is wired up.
def _kubevirt_status_fn() -> dict:
    return {"available": False, "phase": "Unknown"}


class CreateVM(BaseModel):
    name: str
    password: str | None = None
    ssh_key: str | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        validate_name(v)
        return v


@app.get("/api/status")
def status() -> dict:
    return _kubevirt_status_fn()


@app.get("/health")
def health() -> dict:
    # 200 as soon as the API process is up; cluster/KubeVirt readiness is /api/status.
    return {"status": "ok"}


@app.get("/api/vms")
def list_vms(store: VMStore = Depends(get_store)) -> list[dict]:
    return store.list()


@app.get("/api/vms/{name}")
def get_vm(name: str, store: VMStore = Depends(get_store)) -> dict:
    with _translate_404():
        return store.get(name)


@app.post("/api/vms", status_code=201)
def create_vm(body: CreateVM, store: VMStore = Depends(get_store)) -> dict:
    try:
        store.create(body.name, password=body.password, ssh_key=body.ssh_key)
    except CapExceeded as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"name": body.name, "created": True}


@app.post("/api/vms/{name}/start")
def start_vm(name: str, store: VMStore = Depends(get_store)) -> dict:
    with _translate_404():
        store.set_running(name, True)
    return {"name": name, "running": True}


@app.post("/api/vms/{name}/stop")
def stop_vm(name: str, store: VMStore = Depends(get_store)) -> dict:
    with _translate_404():
        store.set_running(name, False)
    return {"name": name, "running": False}


@app.delete("/api/vms/{name}", status_code=204)
def delete_vm(name: str, store: VMStore = Depends(get_store)) -> Response:
    with _translate_404():
        store.delete(name)
    return Response(status_code=204)


# Replaced at startup (later task): returns (api_server, ssl_context, namespace).
def _console_cfg():
    raise RuntimeError("cluster not ready")


@app.websocket("/api/vms/{name}/console")
async def console(ws: WebSocket, name: str):
    await ws.accept(subprotocol=SUBPROTOCOL)
    try:
        api_server, ssl_ctx, namespace = _console_cfg()
    except RuntimeError:
        await ws.close(code=1011, reason="cluster not ready")
        return
    url = console_ws_url(api_server, namespace, name)
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(url, protocols=(SUBPROTOCOL,), ssl=ssl_ctx) as up:
                async def cluster_to_browser():
                    async for msg in up:
                        if msg.type == aiohttp.WSMsgType.BINARY:
                            yield msg.data
                        elif msg.type == aiohttp.WSMsgType.TEXT:
                            yield msg.data.encode()

                async def browser_to_cluster():
                    while True:
                        yield await ws.receive_bytes()

                tasks = [
                    asyncio.create_task(pump(cluster_to_browser(), ws.send_bytes)),
                    asyncio.create_task(pump(browser_to_cluster(), up.send_bytes)),
                ]
                done, pending = await asyncio.wait(
                    tasks, return_when=asyncio.FIRST_COMPLETED
                )
                for t in pending:
                    t.cancel()
                for t in done:
                    exc = t.exception()
                    # WebSocketDisconnect is the normal browser-close signal; anything
                    # else is a real bridge failure worth surfacing.
                    if exc and not isinstance(exc, WebSocketDisconnect):
                        logger.warning("console bridge for %s ended: %r", name, exc)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("console connect for %s failed: %r", name, exc)
    finally:
        with contextlib.suppress(RuntimeError):
            await ws.close()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(_STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
