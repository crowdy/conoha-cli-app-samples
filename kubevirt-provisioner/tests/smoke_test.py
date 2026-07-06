"""Manual end-to-end smoke against a deployed instance.

Usage:
    BASE_URL=https://kubevirt.example.com python tests/smoke_test.py

Not a pytest test (no test_* functions); kept import-safe so the unit suite can
still collect this directory. Validates: health, KubeVirt readiness, VM create →
Running, then cleanup. (Console is validated manually in the browser / see SPIKE_NOTES.md.)
"""
import json
import os
import sys
import time
import urllib.request


def _get(base, path):
    with urllib.request.urlopen(f"{base}{path}", timeout=30) as r:
        return r.status, json.load(r)


def _post(base, path, body=None):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(
        f"{base}{path}", data=data, method="POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def _delete(base, path):
    req = urllib.request.Request(f"{base}{path}", method="DELETE")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def main():
    base = os.environ["BASE_URL"].rstrip("/")

    assert _get(base, "/health")[0] == 200, "health not 200"
    print("health OK")

    for _ in range(60):  # KubeVirt may take minutes on first boot
        if _get(base, "/api/status")[1].get("available"):
            break
        time.sleep(5)
    else:
        sys.exit("KubeVirt never became available")
    print("KubeVirt available")

    assert _post(base, "/api/vms", {"name": "smoke1", "password": "ubuntu"}) == 201
    print("VM created; waiting for Running...")

    for _ in range(60):
        vms = _get(base, "/api/vms")[1]
        vm = next((v for v in vms if v["name"] == "smoke1"), None)
        if vm and vm["status"] == "Running":
            print("VM Running")
            break
        time.sleep(10)
    else:
        sys.exit("VM never reached Running")

    _post(base, "/api/vms/smoke1/stop")
    _delete(base, "/api/vms/smoke1")
    print("cleaned up — SMOKE PASS")


if __name__ == "__main__":
    main()
