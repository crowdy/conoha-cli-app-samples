import pytest
from fastapi.testclient import TestClient
from app.main import app, get_store
from app.vms import CapExceeded


class FakeStore:
    def __init__(self):
        self.vms = [{"name": "a", "running": True, "status": "Running", "ip": "10.0.0.5"}]
        self.cap = False

    def list(self):
        return self.vms

    def get(self, name):
        for vm in self.vms:
            if vm["name"] == name:
                return vm
        from kubernetes.client.exceptions import ApiException
        raise ApiException(status=404)

    def create(self, name, password=None, ssh_key=None):
        if self.cap:
            raise CapExceeded("cap")
        self.vms.append({"name": name, "running": True, "status": "Starting", "ip": None})
        return {}

    def set_running(self, name, running):
        for vm in self.vms:
            if vm["name"] == name:
                vm["running"] = running

    def delete(self, name):
        self.vms = [v for v in self.vms if v["name"] != name]


@pytest.fixture
def client():
    store = FakeStore()
    app.dependency_overrides[get_store] = lambda: store
    c = TestClient(app)
    c.store = store
    yield c
    app.dependency_overrides.clear()


def test_health_ok(client):
    assert client.get("/health").status_code == 200


def test_list_vms(client):
    r = client.get("/api/vms")
    assert r.status_code == 200
    assert r.json()[0]["name"] == "a"


def test_get_vm_detail(client):
    r = client.get("/api/vms/a")
    assert r.status_code == 200
    assert r.json()["name"] == "a"


def test_get_vm_missing_404(client):
    r = client.get("/api/vms/nope")
    assert r.status_code == 404


def test_create_vm(client):
    r = client.post("/api/vms", json={"name": "b", "password": "pw"})
    assert r.status_code == 201
    assert any(v["name"] == "b" for v in client.store.vms)


def test_create_vm_cap_returns_409(client):
    client.store.cap = True
    r = client.post("/api/vms", json={"name": "b", "password": "pw"})
    assert r.status_code == 409


def test_create_vm_bad_name_returns_422(client):
    r = client.post("/api/vms", json={"name": "Bad Name", "password": "pw"})
    assert r.status_code == 422


def test_stop_vm(client):
    r = client.post("/api/vms/a/stop")
    assert r.status_code == 200
    assert client.store.vms[0]["running"] is False


def test_delete_vm(client):
    r = client.delete("/api/vms/a")
    assert r.status_code == 204
    assert not any(v["name"] == "a" for v in client.store.vms)


def test_status_endpoint(client, monkeypatch):
    import app.main as m
    monkeypatch.setattr(m, "_kubevirt_status_fn", lambda: {"available": True, "phase": "Deployed"})
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json()["available"] is True
