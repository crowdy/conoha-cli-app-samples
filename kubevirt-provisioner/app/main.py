from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import Response
from kubernetes.client.exceptions import ApiException
from pydantic import BaseModel, field_validator

from app.manifest import validate_name
from app.vms import CapExceeded, VMStore

app = FastAPI(title="kubevirt-provisioner")

# Populated at startup in a later task. Tests override get_store().
_store: VMStore | None = None


def get_store() -> VMStore:
    if _store is None:
        raise HTTPException(status_code=503, detail="cluster not ready")
    return _store


class CreateVM(BaseModel):
    name: str
    password: str | None = None
    ssh_key: str | None = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        try:
            validate_name(v)
        except ValueError as e:
            raise ValueError(str(e))
        return v


@app.get("/health")
def health() -> dict:
    # 200 as soon as the API process is up; cluster/KubeVirt readiness is /api/status.
    return {"status": "ok"}


@app.get("/api/vms")
def list_vms(store: VMStore = Depends(get_store)) -> list[dict]:
    return store.list()


@app.get("/api/vms/{name}")
def get_vm(name: str, store: VMStore = Depends(get_store)) -> dict:
    try:
        return store.get(name)
    except ApiException as e:
        if e.status == 404:
            raise HTTPException(status_code=404, detail="not found")
        raise


@app.post("/api/vms", status_code=201)
def create_vm(body: CreateVM, store: VMStore = Depends(get_store)) -> dict:
    try:
        store.create(body.name, password=body.password, ssh_key=body.ssh_key)
    except CapExceeded as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"name": body.name, "created": True}


@app.post("/api/vms/{name}/start")
def start_vm(name: str, store: VMStore = Depends(get_store)) -> dict:
    store.set_running(name, True)
    return {"name": name, "running": True}


@app.post("/api/vms/{name}/stop")
def stop_vm(name: str, store: VMStore = Depends(get_store)) -> dict:
    store.set_running(name, False)
    return {"name": name, "running": False}


@app.delete("/api/vms/{name}", status_code=204)
def delete_vm(name: str, store: VMStore = Depends(get_store)) -> Response:
    store.delete(name)
    return Response(status_code=204)
