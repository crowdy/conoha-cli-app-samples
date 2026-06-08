import pytest
from app.vms import running_count, summarize, VMStore, CapExceeded, kubevirt_status


def _vm(name, running=True, status="Running", ip=None):
    obj = {"metadata": {"name": name}, "spec": {"running": running},
           "status": {"printableStatus": status}}
    return obj


def test_running_count_counts_spec_running():
    vms = [_vm("a", running=True), _vm("b", running=False), _vm("c", running=True)]
    assert running_count(vms) == 2


def test_summarize_extracts_fields():
    s = summarize(_vm("a", running=True, status="Running"))
    assert s == {"name": "a", "running": True, "status": "Running", "ip": None}


class FakeCustom:
    """Minimal stand-in for kubernetes CustomObjectsApi."""
    def __init__(self, items):
        self.items = items
        self.created = []
        self.deleted = []
        self.patched = []

    def list_namespaced_custom_object(self, group, version, namespace, plural):
        return {"items": list(self.items)}

    def create_namespaced_custom_object(self, group, version, namespace, plural, body):
        self.created.append(body)
        self.items.append(body)
        return body

    def delete_namespaced_custom_object(self, group, version, namespace, plural, name):
        self.deleted.append(name)

    def patch_namespaced_custom_object(self, group, version, namespace, plural, name, body):
        self.patched.append((name, body))
        return body

    def get_namespaced_custom_object(self, group, version, namespace, plural, name):
        for it in self.items:
            if it["metadata"]["name"] == name:
                return it
        from kubernetes.client.exceptions import ApiException
        raise ApiException(status=404)


def _store(items, max_running=1):
    fake = FakeCustom(items)
    return VMStore(fake, namespace="vms", image="img:24.04", max_running=max_running,
                   memory="2Gi", cpu=1), fake


def test_create_enforces_cap():
    store, _ = _store([_vm("a", running=True)], max_running=1)
    with pytest.raises(CapExceeded):
        store.create("b", password="p")


def test_create_under_cap_calls_api():
    store, fake = _store([], max_running=2)
    store.create("b", password="p")
    assert fake.created and fake.created[0]["metadata"]["name"] == "b"


def test_set_running_patches():
    store, fake = _store([_vm("a")], max_running=2)
    store.set_running("a", False)
    assert fake.patched[0] == ("a", {"spec": {"running": False}})


class FakeKvCustom:
    def __init__(self, obj):
        self.obj = obj

    def get_namespaced_custom_object(self, group, version, namespace, plural, name):
        if self.obj is None:
            from kubernetes.client.exceptions import ApiException
            raise ApiException(status=404)
        return self.obj


def test_kubevirt_status_available():
    obj = {"status": {"phase": "Deployed",
                      "conditions": [{"type": "Available", "status": "True"}]}}
    assert kubevirt_status(FakeKvCustom(obj)) == {"available": True, "phase": "Deployed"}


def test_kubevirt_status_absent():
    assert kubevirt_status(FakeKvCustom(None)) == {"available": False, "phase": "NotFound"}
