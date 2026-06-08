# kubevirt-provisioner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-VPS sample where a FastAPI service provisions Ubuntu guest VMs through the KubeVirt API, with k3s + KubeVirt + FastAPI all running as Docker Compose containers, and a browser web UI exposing a live serial console.

**Architecture:** Three compose services on one ConoHa VPS — `k3s` (single privileged container = the whole cluster, runs the KubeVirt control plane and guest `virt-launcher` pods under QEMU software emulation), `kubevirt-bootstrap` (one-shot: applies pinned KubeVirt manifests with `useEmulation: true`, then exits), and `api` (FastAPI = the conoha `web` service: REST VM lifecycle + xterm.js serial console bridged from KubeVirt's console WebSocket). The `api` talks to k3s via the shared kubeconfig.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, kubernetes (Python client), aiohttp (console WS client), PyYAML, xterm.js, k3s (`rancher/k3s`), KubeVirt v1.4.0, docker compose, ConoHa CLI.

**Spec:** `docs/superpowers/specs/2026-06-08-kubevirt-provisioner-design.md`

**Branch:** `feat/kubevirt-provisioner-sample` (already created from `main`, spec already committed).

---

## Conventions

- All Python: Python 3.12, type hints, `pytest`, `ruff` (line length 100).
- All commits: conventional commits (`feat(scope): ...`, `test(scope): ...`, `chore(scope): ...`). Scope = `kubevirt-provisioner`.
- "Sample dir" = `kubevirt-provisioner/`. "App package" = `kubevirt-provisioner/app/`.
- Run pytest from inside the sample dir: `cd kubevirt-provisioner && python -m pytest`.
- Pinned versions: KubeVirt `v1.4.0`, k3s `rancher/k3s:v1.31.5-k3s1`, guest image `quay.io/containerdisks/ubuntu:24.04`. If the spike (Phase A) finds a version doesn't work, update these everywhere and note it.
- Phase A is a **validation gate**: it is exploratory (not TDD). Its outputs — the exact working k3s container flags, the KubeVirt CR, and emulated boot timings — feed the infra tasks in Phase E. Do not start Phase E until Phase A succeeds.

---

# Phase A — Validation spike (gate before build)

The single biggest risk is "does KubeVirt come up on a containerized single-node k3s under software emulation, and can we reach a guest serial console?" Prove this on a real VPS first. This phase produces a notes file plus the confirmed k3s flags and KubeVirt CR used later.

## Task 1: Scaffold the sample directory and spike notes

**Files:**
- Create: `kubevirt-provisioner/.gitignore`
- Create: `kubevirt-provisioner/SPIKE_NOTES.md`

- [ ] **Step 1: Create the directory and a .gitignore**

```bash
mkdir -p kubevirt-provisioner
cat > kubevirt-provisioner/.gitignore <<'EOF'
__pycache__/
*.pyc
.pytest_cache/
.env
*.kubeconfig
kubeconfig.yaml
EOF
```

- [ ] **Step 2: Create an empty spike notes file with the questions to answer**

```bash
cat > kubevirt-provisioner/SPIKE_NOTES.md <<'EOF'
# Spike notes — kubevirt-provisioner

Record the CONFIRMED working values here. These feed compose.yml / manifests / README.

- [ ] k3s container flags that produce a Ready node (privileged, cgroup, tmpfs mounts)
- [ ] KubeVirt version that reaches `Available` on this k3s
- [ ] Whether any KubeVirt featureGates are required
- [ ] Ubuntu containerDisk VMI reaches `Running` under emulation
- [ ] Serial console WebSocket subprotocol that works (expected: plain.kubevirt.io)
- [ ] Measured emulated boot time (cloud-init done) — sets UI/timeout expectations
- [ ] `--tls-san k3s` lets a second container connect via https://k3s:6443
EOF
```

- [ ] **Step 3: Commit**

```bash
git add kubevirt-provisioner/.gitignore kubevirt-provisioner/SPIKE_NOTES.md
git commit -m "chore(kubevirt-provisioner): scaffold dir + spike notes"
```

## Task 2: Stand up k3s as a single privileged container on a VPS

**Files:**
- Create: `kubevirt-provisioner/spike/compose.k3s.yml`

This is run on a real VPS (`g2l-t-8`, ubuntu-24.04) with Docker installed. It is throwaway scaffolding under `spike/`.

- [ ] **Step 1: Write a minimal k3s-only compose**

```yaml
# kubevirt-provisioner/spike/compose.k3s.yml
services:
  k3s:
    image: rancher/k3s:v1.31.5-k3s1
    privileged: true
    command:
      - server
      - --disable=traefik
      - --disable=servicelb
      - --disable=metrics-server
      - --tls-san=k3s
      - --write-kubeconfig=/output/kubeconfig.yaml
      - --write-kubeconfig-mode=644
    tmpfs:
      - /run
      - /var/run
    volumes:
      - k3s-data:/var/lib/rancher/k3s
      - kubeconfig:/output
    ports:
      - "6443:6443"
    restart: unless-stopped
volumes:
  k3s-data:
  kubeconfig:
```

- [ ] **Step 2: Bring it up and wait for the node**

```bash
cd kubevirt-provisioner/spike
docker compose -f compose.k3s.yml up -d
# wait, then:
docker compose -f compose.k3s.yml exec k3s k3s kubectl get nodes
```
Expected success: one node in `Ready` state within ~60s.
If the node never goes Ready: inspect `docker compose logs k3s`. Common fixes to try and RECORD in SPIKE_NOTES.md: add `cgroup` mount `/sys/fs/cgroup:/sys/fs/cgroup:rw`, add `cgroupns_mode: host` (compose key `cgroup: host`), or add `--kubelet-arg=...`. Lock down the minimal working set.

- [ ] **Step 3: Record the working flags in SPIKE_NOTES.md, then commit the spike compose**

```bash
git add kubevirt-provisioner/spike/compose.k3s.yml kubevirt-provisioner/SPIKE_NOTES.md
git commit -m "chore(kubevirt-provisioner): spike — k3s single-container boots"
```

## Task 3: Install KubeVirt with emulation and run an Ubuntu VMI

**Files:**
- Create: `kubevirt-provisioner/spike/vmi-ubuntu.yaml`

- [ ] **Step 1: Apply pinned KubeVirt operator + CR with emulation**

```bash
cd kubevirt-provisioner/spike
K=( docker compose -f compose.k3s.yml exec k3s k3s kubectl )
"${K[@]}" apply -f https://github.com/kubevirt/kubevirt/releases/download/v1.4.0/kubevirt-operator.yaml
"${K[@]}" apply -f - <<'EOF'
apiVersion: kubevirt.io/v1
kind: KubeVirt
metadata:
  name: kubevirt
  namespace: kubevirt
spec:
  configuration:
    developerConfiguration:
      useEmulation: true
EOF
"${K[@]}" -n kubevirt wait kubevirt/kubevirt --for=condition=Available --timeout=600s
```
Expected success: `kubevirt.kubevirt.io/kubevirt condition met`.
If virt-handler crashloops: check `kubectl -n kubevirt logs ds/virt-handler`. Record any required featureGate or privileged adjustment in SPIKE_NOTES.md.

- [ ] **Step 2: Create a minimal Ubuntu VMI and wait for Running**

```yaml
# kubevirt-provisioner/spike/vmi-ubuntu.yaml
apiVersion: kubevirt.io/v1
kind: VirtualMachineInstance
metadata:
  name: spike-ubuntu
  namespace: default
spec:
  domain:
    cpu:
      cores: 1
    resources:
      requests:
        memory: 2Gi
    devices:
      disks:
        - name: containerdisk
          disk:
            bus: virtio
        - name: cloudinitdisk
          disk:
            bus: virtio
      interfaces:
        - name: default
          masquerade: {}
  networks:
    - name: default
      pod: {}
  volumes:
    - name: containerdisk
      containerDisk:
        image: quay.io/containerdisks/ubuntu:24.04
    - name: cloudinitdisk
      cloudInitNoCloud:
        userData: |
          #cloud-config
          password: ubuntu
          chpasswd: { expire: false }
          ssh_pwauth: true
```

```bash
"${K[@]}" apply -f vmi-ubuntu.yaml
"${K[@]}" wait vmi/spike-ubuntu --for=condition=Ready --timeout=900s -n default
```
Expected success: the VMI reaches `Ready`. **Time this step** and record it.

- [ ] **Step 3: Confirm the serial console responds**

```bash
"${K[@]}" get vmi spike-ubuntu -n default -o jsonpath='{.status.phase}'   # -> Running
# virtctl may not be present; the API path is what `api` will use:
"${K[@]}" get --raw "/apis/subresources.kubevirt.io/v1/namespaces/default/virtualmachineinstances/spike-ubuntu/console" || true
```
The `--raw` GET will fail (console is a WebSocket, not GET) but a 400/426 "upgrade required" style response confirms the endpoint exists. Record the exact path and any subprotocol hints in SPIKE_NOTES.md.

- [ ] **Step 4: Tear down spike VMI, finalize notes, commit**

```bash
"${K[@]}" delete -f vmi-ubuntu.yaml
git add kubevirt-provisioner/spike/vmi-ubuntu.yaml kubevirt-provisioner/SPIKE_NOTES.md
git commit -m "chore(kubevirt-provisioner): spike — KubeVirt emulation + Ubuntu VMI confirmed"
```

> **Gate:** All SPIKE_NOTES.md checkboxes must be filled before Phase E. Phases B–D (pure Python + UI) can proceed in parallel and do not depend on the spike.

---

# Phase B — FastAPI core logic (TDD)

## Task 4: Python project scaffold

**Files:**
- Create: `kubevirt-provisioner/requirements.txt`
- Create: `kubevirt-provisioner/requirements-dev.txt`
- Create: `kubevirt-provisioner/pyproject.toml`
- Create: `kubevirt-provisioner/app/__init__.py`
- Create: `kubevirt-provisioner/tests/__init__.py`

- [ ] **Step 1: Create dependency files**

```text
# kubevirt-provisioner/requirements.txt
fastapi==0.115.6
uvicorn[standard]==0.34.0
kubernetes==31.0.0
aiohttp==3.11.11
PyYAML==6.0.2
```

```text
# kubevirt-provisioner/requirements-dev.txt
-r requirements.txt
pytest==8.3.4
pytest-asyncio==0.25.2
httpx==0.28.1
ruff==0.9.2
```

- [ ] **Step 2: Create pyproject.toml (ruff + pytest config)**

```toml
# kubevirt-provisioner/pyproject.toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: Create empty package markers**

```bash
mkdir -p kubevirt-provisioner/app kubevirt-provisioner/tests
touch kubevirt-provisioner/app/__init__.py kubevirt-provisioner/tests/__init__.py
```

- [ ] **Step 4: Create and activate a venv, install dev deps**

```bash
cd kubevirt-provisioner
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
```
Expected: clean install. (`.venv` is git-ignored.)

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/requirements.txt kubevirt-provisioner/requirements-dev.txt kubevirt-provisioner/pyproject.toml kubevirt-provisioner/app/__init__.py kubevirt-provisioner/tests/__init__.py
git commit -m "chore(kubevirt-provisioner): python project scaffold"
```

## Task 5: VM name validation (`app/manifest.py`)

**Files:**
- Create: `kubevirt-provisioner/app/manifest.py`
- Test: `kubevirt-provisioner/tests/test_manifest.py`

- [ ] **Step 1: Write the failing test**

```python
# kubevirt-provisioner/tests/test_manifest.py
import pytest
from app.manifest import validate_name


@pytest.mark.parametrize("name", ["vm1", "my-ubuntu", "a", "a1-b2-c3"])
def test_validate_name_accepts_valid(name):
    validate_name(name)  # must not raise


@pytest.mark.parametrize("name", ["", "-leads", "trails-", "UPPER", "has_underscore", "a" * 41, "spa ce"])
def test_validate_name_rejects_invalid(name):
    with pytest.raises(ValueError):
        validate_name(name)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_manifest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.manifest'`.

- [ ] **Step 3: Write minimal implementation**

```python
# kubevirt-provisioner/app/manifest.py
import re

# RFC 1123 label, capped at 40 chars to keep generated resource names short.
_NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$")


def validate_name(name: str) -> None:
    """Raise ValueError if name is not a valid DNS-1123-ish VM name (<=40 chars)."""
    if not _NAME_RE.match(name):
        raise ValueError(
            "name must match [a-z0-9-], start/end alphanumeric, 1-40 chars"
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_manifest.py -v`
Expected: PASS (8 cases).

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/manifest.py kubevirt-provisioner/tests/test_manifest.py
git commit -m "feat(kubevirt-provisioner): VM name validation"
```

## Task 6: cloud-init builder (`app/manifest.py`)

**Files:**
- Modify: `kubevirt-provisioner/app/manifest.py`
- Test: `kubevirt-provisioner/tests/test_manifest.py`

- [ ] **Step 1: Add the failing test**

```python
# append to kubevirt-provisioner/tests/test_manifest.py
import yaml
from app.manifest import build_cloud_init, MARKER


def _parse(user_data: str) -> dict:
    assert user_data.startswith("#cloud-config\n")
    return yaml.safe_load(user_data)


def test_cloud_init_sets_password_and_marker():
    cfg = _parse(build_cloud_init(password="secret"))
    assert cfg["password"] == "secret"
    assert cfg["ssh_pwauth"] is True
    assert any(MARKER in str(c) for c in cfg["runcmd"])


def test_cloud_init_adds_ssh_key_when_given():
    cfg = _parse(build_cloud_init(ssh_key="ssh-ed25519 AAAA..."))
    assert cfg["ssh_authorized_keys"] == ["ssh-ed25519 AAAA..."]


def test_cloud_init_omits_ssh_key_when_absent():
    cfg = _parse(build_cloud_init(password="x"))
    assert "ssh_authorized_keys" not in cfg
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_manifest.py -k cloud_init -v`
Expected: FAIL — `ImportError: cannot import name 'build_cloud_init'`.

- [ ] **Step 3: Implement**

```python
# append to kubevirt-provisioner/app/manifest.py
import yaml

MARKER = "kubevirt-provisioner-ready"


def build_cloud_init(
    password: str | None = None,
    ssh_key: str | None = None,
) -> str:
    """Return a #cloud-config userData string for the guest."""
    cfg: dict = {"ssh_pwauth": True}
    if password:
        cfg["password"] = password
        cfg["chpasswd"] = {"expire": False}
    if ssh_key:
        cfg["ssh_authorized_keys"] = [ssh_key]
    cfg["runcmd"] = [["sh", "-c", f"echo {MARKER} > /etc/{MARKER}"]]
    return "#cloud-config\n" + yaml.safe_dump(cfg, sort_keys=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_manifest.py -v`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/manifest.py kubevirt-provisioner/tests/test_manifest.py
git commit -m "feat(kubevirt-provisioner): cloud-init userData builder"
```

## Task 7: VirtualMachine manifest builder (`app/manifest.py`)

**Files:**
- Modify: `kubevirt-provisioner/app/manifest.py`
- Test: `kubevirt-provisioner/tests/test_manifest.py`

- [ ] **Step 1: Add the failing test**

```python
# append to kubevirt-provisioner/tests/test_manifest.py
from app.manifest import build_vm


def test_build_vm_shape():
    vm = build_vm(
        name="web1",
        namespace="vms",
        image="quay.io/containerdisks/ubuntu:24.04",
        memory="2Gi",
        cpu=1,
        password="pw",
    )
    assert vm["apiVersion"] == "kubevirt.io/v1"
    assert vm["kind"] == "VirtualMachine"
    assert vm["metadata"]["name"] == "web1"
    assert vm["metadata"]["namespace"] == "vms"
    assert vm["spec"]["running"] is True
    dom = vm["spec"]["template"]["spec"]["domain"]
    assert dom["cpu"]["cores"] == 1
    assert dom["resources"]["requests"]["memory"] == "2Gi"
    disks = {d["name"] for d in dom["devices"]["disks"]}
    assert disks == {"containerdisk", "cloudinitdisk"}
    assert dom["devices"]["interfaces"][0]["masquerade"] == {}
    vols = {v["name"]: v for v in vm["spec"]["template"]["spec"]["volumes"]}
    assert vols["containerdisk"]["containerDisk"]["image"].endswith("ubuntu:24.04")
    assert vols["cloudinitdisk"]["cloudInitNoCloud"]["userData"].startswith("#cloud-config")
    assert vm["spec"]["template"]["spec"]["networks"][0]["pod"] == {}


def test_build_vm_rejects_bad_name():
    with pytest.raises(ValueError):
        build_vm(name="Bad Name", namespace="vms", image="x", password="p")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_manifest.py -k build_vm -v`
Expected: FAIL — `ImportError: cannot import name 'build_vm'`.

- [ ] **Step 3: Implement**

```python
# append to kubevirt-provisioner/app/manifest.py
MANAGED_BY = "kubevirt-provisioner"


def build_vm(
    name: str,
    *,
    namespace: str,
    image: str,
    memory: str = "2Gi",
    cpu: int = 1,
    password: str | None = None,
    ssh_key: str | None = None,
) -> dict:
    """Build a KubeVirt VirtualMachine manifest (running) for an Ubuntu containerDisk."""
    validate_name(name)
    user_data = build_cloud_init(password=password, ssh_key=ssh_key)
    return {
        "apiVersion": "kubevirt.io/v1",
        "kind": "VirtualMachine",
        "metadata": {
            "name": name,
            "namespace": namespace,
            "labels": {"app.kubernetes.io/managed-by": MANAGED_BY},
        },
        "spec": {
            "running": True,
            "template": {
                "metadata": {"labels": {"kubevirt.io/vm": name}},
                "spec": {
                    "domain": {
                        "cpu": {"cores": cpu},
                        "resources": {"requests": {"memory": memory}},
                        "devices": {
                            "disks": [
                                {"name": "containerdisk", "disk": {"bus": "virtio"}},
                                {"name": "cloudinitdisk", "disk": {"bus": "virtio"}},
                            ],
                            "interfaces": [{"name": "default", "masquerade": {}}],
                        },
                    },
                    "networks": [{"name": "default", "pod": {}}],
                    "volumes": [
                        {"name": "containerdisk", "containerDisk": {"image": image}},
                        {
                            "name": "cloudinitdisk",
                            "cloudInitNoCloud": {"userData": user_data},
                        },
                    ],
                },
            },
        },
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_manifest.py -v`
Expected: PASS (all manifest tests).

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/manifest.py kubevirt-provisioner/tests/test_manifest.py
git commit -m "feat(kubevirt-provisioner): VirtualMachine manifest builder"
```

## Task 8: kubeconfig server rewrite (`app/k8s.py`)

**Files:**
- Create: `kubevirt-provisioner/app/k8s.py`
- Test: `kubevirt-provisioner/tests/test_k8s.py`

- [ ] **Step 1: Write the failing test**

```python
# kubevirt-provisioner/tests/test_k8s.py
from app.k8s import rewrite_kubeconfig_server

SAMPLE = """\
apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: REDACTED
    server: https://127.0.0.1:6443
  name: default
"""


def test_rewrite_replaces_server():
    out = rewrite_kubeconfig_server(SAMPLE, "https://k3s:6443")
    assert "server: https://k3s:6443" in out
    assert "127.0.0.1:6443" not in out
    assert "certificate-authority-data: REDACTED" in out  # untouched


def test_rewrite_is_idempotent():
    once = rewrite_kubeconfig_server(SAMPLE, "https://k3s:6443")
    twice = rewrite_kubeconfig_server(once, "https://k3s:6443")
    assert once == twice
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_k8s.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.k8s'`.

- [ ] **Step 3: Implement**

```python
# kubevirt-provisioner/app/k8s.py
import re

_SERVER_RE = re.compile(r"(?m)^(\s*server:\s*)\S+\s*$")


def rewrite_kubeconfig_server(kubeconfig_yaml: str, new_server: str) -> str:
    """Replace the single k3s cluster `server:` value (127.0.0.1) with new_server.

    k3s writes the kubeconfig with server https://127.0.0.1:6443, which is wrong
    from another container. We point it at the compose service name instead. The
    server cert must carry `k3s` in its SANs (k3s `--tls-san=k3s`).
    """
    return _SERVER_RE.sub(rf"\g<1>{new_server}", kubeconfig_yaml)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_k8s.py -v`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/k8s.py kubevirt-provisioner/tests/test_k8s.py
git commit -m "feat(kubevirt-provisioner): kubeconfig server rewrite helper"
```

## Task 9: kubeconfig preparation + client factory (`app/k8s.py`)

**Files:**
- Modify: `kubevirt-provisioner/app/k8s.py`
- Test: `kubevirt-provisioner/tests/test_k8s.py`

- [ ] **Step 1: Add the failing test for `prepare_kubeconfig`**

```python
# append to kubevirt-provisioner/tests/test_k8s.py
from app.k8s import prepare_kubeconfig


def test_prepare_kubeconfig_writes_rewritten_copy(tmp_path):
    src = tmp_path / "src.yaml"
    src.write_text(SAMPLE)
    dst = tmp_path / "out.yaml"
    prepare_kubeconfig(str(src), str(dst), "https://k3s:6443")
    text = dst.read_text()
    assert "server: https://k3s:6443" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_k8s.py -k prepare -v`
Expected: FAIL — `ImportError: cannot import name 'prepare_kubeconfig'`.

- [ ] **Step 3: Implement `prepare_kubeconfig` and a `load_clients` factory**

```python
# append to kubevirt-provisioner/app/k8s.py
from pathlib import Path

from kubernetes import client, config


def prepare_kubeconfig(src_path: str, dst_path: str, server: str) -> str:
    """Read the shared kubeconfig, rewrite its server, write to dst_path. Returns dst_path."""
    text = Path(src_path).read_text()
    Path(dst_path).write_text(rewrite_kubeconfig_server(text, server))
    return dst_path


def load_clients(kubeconfig_path: str):
    """Load kube clients from a prepared kubeconfig.

    Returns (CoreV1Api, CustomObjectsApi). Separated from prepare_kubeconfig so the
    rewrite stays unit-testable without a real cluster.
    """
    config.load_kube_config(config_file=kubeconfig_path)
    return client.CoreV1Api(), client.CustomObjectsApi()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_k8s.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/k8s.py kubevirt-provisioner/tests/test_k8s.py
git commit -m "feat(kubevirt-provisioner): kubeconfig prep + client factory"
```

## Task 10: VM store + cap logic (`app/vms.py`)

**Files:**
- Create: `kubevirt-provisioner/app/vms.py`
- Test: `kubevirt-provisioner/tests/test_vms.py`

- [ ] **Step 1: Write the failing test (pure helpers + store with a fake client)**

```python
# kubevirt-provisioner/tests/test_vms.py
import pytest
from app.vms import running_count, summarize, VMStore, CapExceeded


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_vms.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.vms'`.

- [ ] **Step 3: Implement**

```python
# kubevirt-provisioner/app/vms.py
from app.manifest import build_vm

GROUP = "kubevirt.io"
VERSION = "v1"
VM_PLURAL = "virtualmachines"
VMI_PLURAL = "virtualmachineinstances"


class CapExceeded(Exception):
    """Raised when creating a VM would exceed the running-VM cap."""


def running_count(vms: list[dict]) -> int:
    return sum(1 for vm in vms if vm.get("spec", {}).get("running"))


def summarize(vm: dict) -> dict:
    status = vm.get("status", {})
    ip = None
    for iface in status.get("interfaces", []) or []:
        if iface.get("ipAddress"):
            ip = iface["ipAddress"]
            break
    return {
        "name": vm["metadata"]["name"],
        "running": bool(vm.get("spec", {}).get("running")),
        "status": status.get("printableStatus", "Unknown"),
        "ip": ip,
    }


class VMStore:
    def __init__(self, custom_api, *, namespace, image, max_running, memory="2Gi", cpu=1):
        self.api = custom_api
        self.namespace = namespace
        self.image = image
        self.max_running = max_running
        self.memory = memory
        self.cpu = cpu

    def _list_raw(self) -> list[dict]:
        return self.api.list_namespaced_custom_object(
            GROUP, VERSION, self.namespace, VM_PLURAL
        )["items"]

    def list(self) -> list[dict]:
        return [summarize(vm) for vm in self._list_raw()]

    def create(self, name: str, *, password=None, ssh_key=None) -> dict:
        if running_count(self._list_raw()) >= self.max_running:
            raise CapExceeded(f"running VM cap reached ({self.max_running})")
        body = build_vm(
            name, namespace=self.namespace, image=self.image,
            memory=self.memory, cpu=self.cpu, password=password, ssh_key=ssh_key,
        )
        return self.api.create_namespaced_custom_object(
            GROUP, VERSION, self.namespace, VM_PLURAL, body
        )

    def set_running(self, name: str, running: bool) -> None:
        self.api.patch_namespaced_custom_object(
            GROUP, VERSION, self.namespace, VM_PLURAL, name,
            {"spec": {"running": running}},
        )

    def delete(self, name: str) -> None:
        self.api.delete_namespaced_custom_object(
            GROUP, VERSION, self.namespace, VM_PLURAL, name
        )

    def get(self, name: str) -> dict:
        return summarize(
            self.api.get_namespaced_custom_object(
                GROUP, VERSION, self.namespace, VM_PLURAL, name
            )
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_vms.py -v`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/vms.py kubevirt-provisioner/tests/test_vms.py
git commit -m "feat(kubevirt-provisioner): VM store + running-cap logic"
```

## Task 11: FastAPI app + routes (`app/main.py`)

**Files:**
- Create: `kubevirt-provisioner/app/main.py`
- Test: `kubevirt-provisioner/tests/test_api.py`

- [ ] **Step 1: Write the failing test (TestClient with a fake store injected)**

```python
# kubevirt-provisioner/tests/test_api.py
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

    def create(self, name, password=None, ssh_key=None):
        if self.cap:
            raise CapExceeded("cap")
        self.vms.append({"name": name, "running": True, "status": "Starting", "ip": None})
        return {}

    def get(self, name):
        for vm in self.vms:
            if vm["name"] == name:
                return vm
        from kubernetes.client.exceptions import ApiException
        raise ApiException(status=404)

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
    # health does not depend on the store; cluster reachability is checked elsewhere.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 3: Implement the app**

```python
# kubevirt-provisioner/app/main.py
import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from kubernetes.client.exceptions import ApiException
from pydantic import BaseModel, field_validator

from app.manifest import validate_name
from app.vms import CapExceeded, VMStore

app = FastAPI(title="kubevirt-provisioner")

# Populated at startup (see Task 16 lifespan). Tests override get_store().
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
```

> Note: `/`, `/api/status`, the static mount, and the console WebSocket are added in later tasks (12, 14, 16). Keep this task focused on the REST lifecycle so its tests stay isolated.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_api.py -v`
Expected: PASS (all cases). The bad-name case returns 422 because Pydantic validation fails.

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/main.py kubevirt-provisioner/tests/test_api.py
git commit -m "feat(kubevirt-provisioner): FastAPI VM lifecycle routes"
```

## Task 12: KubeVirt readiness `/api/status` endpoint

**Files:**
- Modify: `kubevirt-provisioner/app/vms.py` (add `kubevirt_status`)
- Modify: `kubevirt-provisioner/app/main.py` (add `/api/status`)
- Test: `kubevirt-provisioner/tests/test_vms.py`, `kubevirt-provisioner/tests/test_api.py`

- [ ] **Step 1: Add failing test for `kubevirt_status` helper**

```python
# append to kubevirt-provisioner/tests/test_vms.py
from app.vms import kubevirt_status


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_vms.py -k kubevirt_status -v`
Expected: FAIL — `ImportError: cannot import name 'kubevirt_status'`.

- [ ] **Step 3: Implement `kubevirt_status`**

```python
# append to kubevirt-provisioner/app/vms.py
from kubernetes.client.exceptions import ApiException


def kubevirt_status(custom_api) -> dict:
    """Return {'available': bool, 'phase': str} for the kubevirt CR."""
    try:
        obj = custom_api.get_namespaced_custom_object(
            GROUP, VERSION, "kubevirt", "kubevirts", "kubevirt"
        )
    except ApiException as e:
        if e.status == 404:
            return {"available": False, "phase": "NotFound"}
        raise
    status = obj.get("status", {})
    available = any(
        c.get("type") == "Available" and c.get("status") == "True"
        for c in status.get("conditions", [])
    )
    return {"available": available, "phase": status.get("phase", "Unknown")}
```

- [ ] **Step 4: Add failing test for the `/api/status` route**

```python
# append to kubevirt-provisioner/tests/test_api.py
def test_status_endpoint(client, monkeypatch):
    import app.main as m
    monkeypatch.setattr(m, "_kubevirt_status_fn", lambda: {"available": True, "phase": "Deployed"})
    r = client.get("/api/status")
    assert r.status_code == 200
    assert r.json()["available"] is True
```

- [ ] **Step 5: Run it (fails — route missing)**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_api.py -k status -v`
Expected: FAIL — 404 for `/api/status`.

- [ ] **Step 6: Implement the route**

```python
# add to kubevirt-provisioner/app/main.py (near other routes)

# Replaced at startup with a real cluster-backed callable (Task 16). Default
# returns "not ready" so the route is safe before the cluster is wired up.
def _kubevirt_status_fn() -> dict:
    return {"available": False, "phase": "Unknown"}


@app.get("/api/status")
def status() -> dict:
    return _kubevirt_status_fn()
```

- [ ] **Step 7: Run tests to verify pass**

Run: `cd kubevirt-provisioner && python -m pytest tests/ -v`
Expected: PASS (all suites).

- [ ] **Step 8: Commit**

```bash
git add kubevirt-provisioner/app/vms.py kubevirt-provisioner/app/main.py kubevirt-provisioner/tests/
git commit -m "feat(kubevirt-provisioner): /api/status KubeVirt readiness"
```

---

# Phase C — Serial console bridge

## Task 13: Console URL + SSL context helpers (`app/console.py`)

**Files:**
- Create: `kubevirt-provisioner/app/console.py`
- Test: `kubevirt-provisioner/tests/test_console.py`

- [ ] **Step 1: Write the failing test (pure helpers)**

```python
# kubevirt-provisioner/tests/test_console.py
from app.console import console_ws_url, SUBPROTOCOL


def test_console_ws_url():
    url = console_ws_url("https://k3s:6443", "vms", "web1")
    assert url == (
        "wss://k3s:6443/apis/subresources.kubevirt.io/v1/namespaces/vms/"
        "virtualmachineinstances/web1/console"
    )


def test_subprotocol_constant():
    assert SUBPROTOCOL == "plain.kubevirt.io"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_console.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.console'`.

- [ ] **Step 3: Implement helpers**

```python
# kubevirt-provisioner/app/console.py
import ssl

# Confirmed in the Phase A spike. KubeVirt streams the serial console as a
# binary WebSocket negotiated with this subprotocol.
SUBPROTOCOL = "plain.kubevirt.io"


def console_ws_url(api_server: str, namespace: str, name: str) -> str:
    """Build the KubeVirt serial-console WebSocket URL (https:// -> wss://)."""
    base = api_server.replace("https://", "wss://").replace("http://", "ws://")
    return (
        f"{base}/apis/subresources.kubevirt.io/v1/namespaces/{namespace}/"
        f"virtualmachineinstances/{name}/console"
    )


def build_ssl_context(ca_cert: str, client_cert: str, client_key: str) -> ssl.SSLContext:
    """SSL context that trusts the cluster CA and presents the admin client cert."""
    ctx = ssl.create_default_context(cafile=ca_cert)
    ctx.load_cert_chain(certfile=client_cert, keyfile=client_key)
    return ctx
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_console.py -v`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/console.py kubevirt-provisioner/tests/test_console.py
git commit -m "feat(kubevirt-provisioner): console URL + SSL context helpers"
```

## Task 14: Bidirectional WS bridge + WebSocket route

**Files:**
- Modify: `kubevirt-provisioner/app/console.py` (add `pump`)
- Modify: `kubevirt-provisioner/app/main.py` (add WS route + static mount + `/`)
- Test: `kubevirt-provisioner/tests/test_console.py`

- [ ] **Step 1: Add failing test for the `pump` coroutine using fakes**

```python
# append to kubevirt-provisioner/tests/test_console.py
import pytest
from app.console import pump


class FakeSource:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    async def __aiter__(self):
        for c in self._chunks:
            yield c


class FakeSink:
    def __init__(self):
        self.received = []

    async def send(self, data):
        self.received.append(data)


@pytest.mark.asyncio
async def test_pump_forwards_all_chunks():
    src = FakeSource([b"hello", b"world"])
    sink = FakeSink()
    await pump(src, sink.send)
    assert sink.received == [b"hello", b"world"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_console.py -k pump -v`
Expected: FAIL — `ImportError: cannot import name 'pump'`.

- [ ] **Step 3: Implement `pump`**

```python
# append to kubevirt-provisioner/app/console.py
from typing import Awaitable, Callable


async def pump(source, send: Callable[[bytes], Awaitable[None]]) -> None:
    """Forward every chunk from an async-iterable source to send()."""
    async for chunk in source:
        await send(chunk)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd kubevirt-provisioner && python -m pytest tests/test_console.py -v`
Expected: PASS.

- [ ] **Step 5: Wire the WebSocket route, static files, and index in `main.py`**

This route is integration-level (exercised in the Phase F e2e smoke, not unit-tested). Add `aiohttp` import and the console bridge. `_console_cfg()` is replaced at startup (Task 16) with real cert/host values.

```python
# add to kubevirt-provisioner/app/main.py
import asyncio

import aiohttp
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from app.console import SUBPROTOCOL, build_ssl_context, console_ws_url, pump

# Replaced at startup (Task 16): returns (api_server, ssl_context, namespace).
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
    session = aiohttp.ClientSession()
    try:
        async with session.ws_connect(url, protocols=(SUBPROTOCOL,), ssl=ssl_ctx) as up:
            async def up_to_browser():
                async for msg in up:
                    if msg.type == aiohttp.WSMsgType.BINARY:
                        await ws.send_bytes(msg.data)
                    elif msg.type == aiohttp.WSMsgType.TEXT:
                        await ws.send_text(msg.data)

            async def browser_to_up():
                while True:
                    data = await ws.receive_bytes()
                    await up.send_bytes(data)

            await asyncio.gather(up_to_browser(), browser_to_up())
    except WebSocketDisconnect:
        pass
    finally:
        await session.close()


@app.get("/")
def index() -> FileResponse:
    return FileResponse("app/static/index.html")
```

Add the static mount at the **end** of `main.py` (mounting at `/static` so it doesn't shadow `/api`):

```python
# at the very end of kubevirt-provisioner/app/main.py
app.mount("/static", StaticFiles(directory="app/static"), name="static")
```

- [ ] **Step 6: Run the whole suite (WS route has no unit test; ensure nothing else broke)**

Run: `cd kubevirt-provisioner && python -m pytest tests/ -v`
Expected: PASS. (The `/` and `/static` routes need `app/static/` to exist for runtime, created in Task 15 — tests don't hit them yet.)

- [ ] **Step 7: Commit**

```bash
git add kubevirt-provisioner/app/console.py kubevirt-provisioner/app/main.py kubevirt-provisioner/tests/test_console.py
git commit -m "feat(kubevirt-provisioner): serial console WebSocket bridge"
```

---

# Phase D — Web UI

## Task 15: Static UI (list / create / lifecycle / xterm console)

**Files:**
- Create: `kubevirt-provisioner/app/static/index.html`
- Create: `kubevirt-provisioner/app/static/app.js`
- Vendor: `kubevirt-provisioner/app/static/vendor/xterm.js`, `xterm.css` (download pinned)

- [ ] **Step 1: Vendor xterm.js (pinned, so no CDN dependency at runtime)**

```bash
cd kubevirt-provisioner/app/static
mkdir -p vendor
curl -L https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js -o vendor/xterm.js
curl -L https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css -o vendor/xterm.css
```
Expected: both files non-empty.

- [ ] **Step 2: Write index.html**

```html
<!-- kubevirt-provisioner/app/static/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KubeVirt Provisioner</title>
  <link rel="stylesheet" href="/static/vendor/xterm.css" />
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 960px; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ccc; padding: .4rem .6rem; text-align: left; }
    button { margin-right: .3rem; }
    #term { height: 360px; background: #000; margin-top: 1rem; }
    .banner { padding: .5rem; background: #fffae6; border: 1px solid #e6d600; }
  </style>
</head>
<body>
  <h1>KubeVirt Provisioner</h1>
  <div id="status" class="banner">checking KubeVirt status…</div>

  <h2>Create VM</h2>
  <form id="create-form">
    <input id="vm-name" placeholder="vm name (a-z0-9-)" required />
    <input id="vm-pass" placeholder="login password" value="ubuntu" />
    <button type="submit">Create</button>
  </form>

  <h2>VMs</h2>
  <table>
    <thead><tr><th>name</th><th>status</th><th>ip</th><th>actions</th></tr></thead>
    <tbody id="vm-rows"></tbody>
  </table>

  <h2>Console</h2>
  <div>Connected to: <span id="console-vm">—</span></div>
  <div id="term"></div>

  <script src="/static/vendor/xterm.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write app.js**

```javascript
// kubevirt-provisioner/app/static/app.js
const $ = (id) => document.getElementById(id);

async function refreshStatus() {
  const s = await fetch("/api/status").then((r) => r.json());
  $("status").textContent = s.available
    ? `KubeVirt ready (phase: ${s.phase})`
    : `KubeVirt initializing… (phase: ${s.phase})`;
}

async function refreshVMs() {
  const vms = await fetch("/api/vms").then((r) => r.json());
  const rows = vms.map((vm) => {
    const toggle = vm.running
      ? `<button data-act="stop" data-name="${vm.name}">Stop</button>`
      : `<button data-act="start" data-name="${vm.name}">Start</button>`;
    return `<tr>
      <td>${vm.name}</td><td>${vm.status}</td><td>${vm.ip || "—"}</td>
      <td>
        ${toggle}
        <button data-act="console" data-name="${vm.name}">Console</button>
        <button data-act="delete" data-name="${vm.name}">Delete</button>
      </td></tr>`;
  });
  $("vm-rows").innerHTML = rows.join("");
}

$("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("vm-name").value.trim();
  const password = $("vm-pass").value;
  const r = await fetch("/api/vms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  if (!r.ok) alert(`create failed: ${r.status} ${await r.text()}`);
  $("vm-name").value = "";
  refreshVMs();
});

let term, socket;
function openConsole(name) {
  $("console-vm").textContent = name;
  if (!term) {
    term = new Terminal({ convertEol: true });
    term.open($("term"));
  }
  term.clear();
  if (socket) socket.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/api/vms/${name}/console`, "plain.kubevirt.io");
  socket.binaryType = "arraybuffer";
  socket.onmessage = (ev) => term.write(new Uint8Array(ev.data));
  term.onData((d) => socket.readyState === 1 && socket.send(new TextEncoder().encode(d)));
}

$("vm-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const { act, name } = btn.dataset;
  if (act === "console") return openConsole(name);
  if (act === "delete") await fetch(`/api/vms/${name}`, { method: "DELETE" });
  else await fetch(`/api/vms/${name}/${act}`, { method: "POST" });
  refreshVMs();
});

refreshStatus();
refreshVMs();
setInterval(refreshStatus, 5000);
setInterval(refreshVMs, 5000);
```

- [ ] **Step 4: Manual local sanity check (no cluster needed)**

Run: `cd kubevirt-provisioner && . .venv/bin/activate && uvicorn app.main:app --port 8080`
Then in another shell: `curl -s localhost:8080/ | grep -q "KubeVirt Provisioner" && echo OK`
Expected: `OK`. (`/api/vms` will 503 without a cluster — expected. Ctrl-C to stop.)

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/app/static/
git commit -m "feat(kubevirt-provisioner): static web UI with xterm.js console"
```

---

# Phase E — Infra assembly (uses Phase A spike outputs)

## Task 16: App startup wiring (lifespan: kubeconfig prep + clients + cluster-backed callables)

**Files:**
- Modify: `kubevirt-provisioner/app/main.py`
- Modify: `kubevirt-provisioner/tests/test_api.py` (guard: startup must not run during unit tests)

- [ ] **Step 1: Implement a lifespan that builds the real store and rebinds callables**

This replaces the placeholder `_store`, `_kubevirt_status_fn`, and `_console_cfg` with cluster-backed implementations when env vars are present. Tests don't set these env vars, so startup is a no-op under pytest.

```python
# add near the top of kubevirt-provisioner/app/main.py, and pass lifespan=lifespan to FastAPI(...)
from contextlib import asynccontextmanager

from kubernetes import client as k8s_client

from app import vms as vms_mod
from app.console import build_ssl_context
from app.k8s import load_clients, prepare_kubeconfig


@asynccontextmanager
async def lifespan(app: FastAPI):
    src = os.environ.get("SOURCE_KUBECONFIG")
    if src:
        server = os.environ.get("K3S_SERVER", "https://k3s:6443")
        path = prepare_kubeconfig(src, "/tmp/kubeconfig.yaml", server)
        core, custom = load_clients(path)

        global _store, _kubevirt_status_fn, _console_cfg
        _store = VMStore(
            custom,
            namespace=os.environ.get("VM_NAMESPACE", "vms"),
            image=os.environ.get("GUEST_IMAGE", "quay.io/containerdisks/ubuntu:24.04"),
            max_running=int(os.environ.get("MAX_RUNNING_VMS", "1")),
            memory=os.environ.get("GUEST_MEMORY", "2Gi"),
            cpu=int(os.environ.get("GUEST_CPU", "1")),
        )
        _kubevirt_status_fn = lambda: vms_mod.kubevirt_status(custom)  # noqa: E731

        cfg = k8s_client.Configuration.get_default_copy()
        ssl_ctx = build_ssl_context(cfg.ssl_ca_cert, cfg.cert_file, cfg.key_file)
        ns = os.environ.get("VM_NAMESPACE", "vms")

        def _cfg():
            return (server, ssl_ctx, ns)

        _console_cfg = _cfg
    yield
```

Change the app constructor line to: `app = FastAPI(title="kubevirt-provisioner", lifespan=lifespan)`.
Also change the placeholder `_store` declaration so the lifespan can reassign module globals — it already uses `global`, and `_kubevirt_status_fn` / `_console_cfg` are module-level defs, so reassigning them as module globals works.

- [ ] **Step 2: Verify unit tests still pass (no env vars → lifespan no-op)**

Run: `cd kubevirt-provisioner && python -m pytest tests/ -v`
Expected: PASS (all suites). TestClient triggers lifespan, but with no `SOURCE_KUBECONFIG` it does nothing and the `get_store` override still applies.

- [ ] **Step 3: Commit**

```bash
git add kubevirt-provisioner/app/main.py
git commit -m "feat(kubevirt-provisioner): startup lifespan wires cluster clients"
```

## Task 17: Vendor pinned KubeVirt manifests

**Files:**
- Create: `kubevirt-provisioner/manifests/kubevirt-operator.yaml`
- Create: `kubevirt-provisioner/manifests/kubevirt-cr.yaml`

- [ ] **Step 1: Download the pinned operator manifest (version confirmed in spike)**

```bash
mkdir -p kubevirt-provisioner/manifests
curl -L https://github.com/kubevirt/kubevirt/releases/download/v1.4.0/kubevirt-operator.yaml \
  -o kubevirt-provisioner/manifests/kubevirt-operator.yaml
```
Expected: non-empty YAML (~hundreds of KB).

- [ ] **Step 2: Write the CR with emulation enabled (mirror the spike's working CR)**

```yaml
# kubevirt-provisioner/manifests/kubevirt-cr.yaml
apiVersion: kubevirt.io/v1
kind: KubeVirt
metadata:
  name: kubevirt
  namespace: kubevirt
spec:
  configuration:
    developerConfiguration:
      # ConoHa VPS has no nested virtualization, so KubeVirt falls back to
      # QEMU software emulation (10-100x slower; fine for this demo).
      useEmulation: true
```

- [ ] **Step 3: Commit**

```bash
git add kubevirt-provisioner/manifests/
git commit -m "chore(kubevirt-provisioner): vendor pinned KubeVirt v1.4.0 manifests"
```

## Task 18: Bootstrap image + entrypoint

**Files:**
- Create: `kubevirt-provisioner/bootstrap/Dockerfile`
- Create: `kubevirt-provisioner/bootstrap/entrypoint.sh`

- [ ] **Step 1: Write the entrypoint (wait → apply → wait Available → create ns → exit)**

```bash
# kubevirt-provisioner/bootstrap/entrypoint.sh
#!/usr/bin/env sh
set -eu

KUBECONFIG_SRC="${KUBECONFIG_SRC:-/output/kubeconfig.yaml}"
NS="${VM_NAMESPACE:-vms}"
export KUBECONFIG=/tmp/kubeconfig.yaml

echo "[bootstrap] waiting for kubeconfig at $KUBECONFIG_SRC ..."
while [ ! -f "$KUBECONFIG_SRC" ]; do sleep 2; done
# Rewrite the server to the compose service name (cert SAN covers k3s via --tls-san=k3s).
sed 's#server: https://127.0.0.1:6443#server: https://k3s:6443#' "$KUBECONFIG_SRC" > "$KUBECONFIG"

echo "[bootstrap] waiting for cluster /readyz ..."
until kubectl get --raw=/readyz >/dev/null 2>&1; do sleep 3; done

echo "[bootstrap] applying KubeVirt operator + CR ..."
kubectl apply -f /manifests/kubevirt-operator.yaml
kubectl apply -f /manifests/kubevirt-cr.yaml

echo "[bootstrap] waiting for KubeVirt Available (up to 10m) ..."
kubectl -n kubevirt wait kubevirt/kubevirt --for=condition=Available --timeout=600s

echo "[bootstrap] ensuring namespace $NS ..."
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

echo "[bootstrap] done."
```

- [ ] **Step 2: Write the bootstrap Dockerfile**

```dockerfile
# kubevirt-provisioner/bootstrap/Dockerfile
FROM bitnami/kubectl:1.31
USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 3: Lint the script**

Run: `sh -n kubevirt-provisioner/bootstrap/entrypoint.sh && echo OK`
Expected: `OK` (syntax valid).

- [ ] **Step 4: Commit**

```bash
git add kubevirt-provisioner/bootstrap/
git commit -m "feat(kubevirt-provisioner): KubeVirt bootstrap one-shot container"
```

## Task 19: API Dockerfile + entrypoint

**Files:**
- Create: `kubevirt-provisioner/Dockerfile`
- Create: `kubevirt-provisioner/entrypoint.sh`
- Create: `kubevirt-provisioner/.dockerignore`

- [ ] **Step 1: Write the api entrypoint (wait for kubeconfig, then uvicorn)**

```bash
# kubevirt-provisioner/entrypoint.sh
#!/usr/bin/env sh
set -eu
SRC="${SOURCE_KUBECONFIG:-/output/kubeconfig.yaml}"
echo "[api] waiting for kubeconfig at $SRC ..."
while [ ! -f "$SRC" ]; do sleep 2; done
exec uvicorn app.main:app --host 0.0.0.0 --port 8080
```

- [ ] **Step 2: Write the Dockerfile**

```dockerfile
# kubevirt-provisioner/Dockerfile
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["./entrypoint.sh"]
```

- [ ] **Step 3: Write .dockerignore**

```text
# kubevirt-provisioner/.dockerignore
.venv
__pycache__
*.pyc
.pytest_cache
tests
spike
SPIKE_NOTES.md
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd kubevirt-provisioner && docker build -t kubevirt-provisioner-api:local .`
Expected: successful build.

- [ ] **Step 5: Commit**

```bash
git add kubevirt-provisioner/Dockerfile kubevirt-provisioner/entrypoint.sh kubevirt-provisioner/.dockerignore
git commit -m "feat(kubevirt-provisioner): api image + entrypoint"
```

## Task 20: compose.yml (3 services, using spike-confirmed k3s flags)

**Files:**
- Create: `kubevirt-provisioner/compose.yml`
- Create: `kubevirt-provisioner/.env.example`

- [ ] **Step 1: Write compose.yml**

Use the **exact k3s flags/mounts confirmed in Phase A** (cgroup/tmpfs settings may differ from this baseline — update to match SPIKE_NOTES.md).

```yaml
# kubevirt-provisioner/compose.yml
services:
  # The whole Kubernetes cluster in one privileged container. Runs the KubeVirt
  # control plane and the guest virt-launcher pods (QEMU emulation). Stateful +
  # privileged single instance — cannot be duplicated per blue/green slot.
  k3s:
    image: rancher/k3s:v1.31.5-k3s1
    privileged: true
    command:
      - server
      - --disable=traefik
      - --disable=servicelb
      - --disable=metrics-server
      - --tls-san=k3s
      - --write-kubeconfig=/output/kubeconfig.yaml
      - --write-kubeconfig-mode=644
    tmpfs:
      - /run
      - /var/run
    volumes:
      - k3s-data:/var/lib/rancher/k3s
      - kubeconfig:/output
    healthcheck:
      test: ["CMD", "k3s", "kubectl", "get", "--raw=/readyz"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 30s
    restart: unless-stopped

  # One-shot: applies KubeVirt and exits. Re-running is idempotent.
  kubevirt-bootstrap:
    build: ./bootstrap
    environment:
      - VM_NAMESPACE=${VM_NAMESPACE:-vms}
    volumes:
      - kubeconfig:/output
      - ./manifests:/manifests:ro
    depends_on:
      k3s:
        condition: service_healthy
    restart: "no"

  # FastAPI provisioner = the conoha `web` service.
  api:
    build: .
    environment:
      - SOURCE_KUBECONFIG=/output/kubeconfig.yaml
      - K3S_SERVER=https://k3s:6443
      - VM_NAMESPACE=${VM_NAMESPACE:-vms}
      - GUEST_IMAGE=${GUEST_IMAGE:-quay.io/containerdisks/ubuntu:24.04}
      - GUEST_MEMORY=${GUEST_MEMORY:-2Gi}
      - GUEST_CPU=${GUEST_CPU:-1}
      - MAX_RUNNING_VMS=${MAX_RUNNING_VMS:-1}
    expose:
      - "8080"
    volumes:
      - kubeconfig:/output:ro
    depends_on:
      k3s:
        condition: service_healthy
    restart: unless-stopped

volumes:
  k3s-data:
  kubeconfig:
```

- [ ] **Step 2: Write .env.example**

```text
# kubevirt-provisioner/.env.example
VM_NAMESPACE=vms
GUEST_IMAGE=quay.io/containerdisks/ubuntu:24.04
GUEST_MEMORY=2Gi
GUEST_CPU=1
# Concurrent running-VM cap. Keep low under software emulation (RAM heavy).
MAX_RUNNING_VMS=1
```

- [ ] **Step 3: Validate compose syntax**

Run: `cd kubevirt-provisioner && docker compose config >/dev/null && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add kubevirt-provisioner/compose.yml kubevirt-provisioner/.env.example
git commit -m "feat(kubevirt-provisioner): compose with k3s + bootstrap + api"
```

## Task 21: conoha.yml

**Files:**
- Create: `kubevirt-provisioner/conoha.yml`

- [ ] **Step 1: Write conoha.yml**

```yaml
# kubevirt-provisioner/conoha.yml
name: kubevirt-provisioner
# Replace with your own FQDN before running `conoha app init`.
hosts:
  - kubevirt.example.com
web:
  service: api
  port: 8080
  # k3s is a privileged, stateful single instance (cluster state + containerd
  # images live in the k3s-data volume); slots cannot be duplicated.
  blue_green: false
health:
  path: /health
  # 60 x 5s = 300s. Covers k3s boot + KubeVirt operator image pulls. /health
  # returns 200 as soon as the api process is up; KubeVirt readiness is /api/status.
  unhealthy_threshold: 60
accessories:
  - k3s
  - kubevirt-bootstrap
```

- [ ] **Step 2: Commit**

```bash
git add kubevirt-provisioner/conoha.yml
git commit -m "feat(kubevirt-provisioner): conoha.yml (web=api, blue_green off)"
```

---

# Phase F — Docs + end-to-end smoke

## Task 22: README

**Files:**
- Create: `kubevirt-provisioner/README.md`

- [ ] **Step 1: Write the README**

Cover: what it is, architecture diagram (reuse the spec's ASCII), why emulation (link the spec), deploy steps, how to use the UI, the `MAX_RUNNING_VMS` cap, ephemeral-disk caveat, recommended flavor `g2l-t-8`, and the Out of Scope list. Model the structure on `dns-server/README.md` and `slurm-rest-api/README.md`.

```markdown
# kubevirt-provisioner

Provision Ubuntu VMs through the **KubeVirt** API from a Python **FastAPI** service —
k3s, KubeVirt, and the API all run as Docker Compose containers inside **one** ConoHa VPS.
A browser UI lets you create / start / stop / delete VMs and open a live **serial console**.

> ConoHa VPS has no nested virtualization, so KubeVirt runs in **software emulation**
> (`useEmulation: true`). Guests boot 10-100x slower than with KVM — this is a demo, not
> production. See `docs/superpowers/specs/2026-06-08-kubevirt-provisioner-design.md`.

## Architecture

(reuse the ASCII diagram from the spec — 3 services: api / k3s / kubevirt-bootstrap)

## Deploy

\`\`\`bash
conoha server create --name kubevirt --flavor g2l-t-8 --image ubuntu-24.04 --key mykey
# edit conoha.yml hosts: -> your FQDN (A record -> the VPS)
conoha proxy boot --acme-email you@example.com kubevirt
conoha app init kubevirt
conoha app deploy kubevirt
# First boot takes several minutes (k3s + KubeVirt image pulls). Then open https://<FQDN>.
\`\`\`

## Using it

- The banner shows KubeVirt status (initializing → ready).
- "Create VM" → a row appears; status goes Starting → Running (slow under emulation).
- "Console" → serial console in the browser (login: ubuntu / your password).
- VMs use ephemeral containerDisks — stopping/restarting resets the guest.

## Config (.env)

| var | default | meaning |
|-----|---------|---------|
| `MAX_RUNNING_VMS` | 1 | concurrent running-VM cap (RAM protection under emulation) |
| `GUEST_MEMORY` | 2Gi | per-guest memory |
| `GUEST_CPU` | 1 | per-guest vCPUs |
| `GUEST_IMAGE` | quay.io/containerdisks/ubuntu:24.04 | guest containerDisk |

## Out of scope

Production use, multi-node, persistent disks (CDI/DataVolume), live migration,
GPU passthrough, direct external guest SSH (console is web-only), multi-tenant authz.
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add kubevirt-provisioner/README.md
git commit -m "docs(kubevirt-provisioner): README"
```

## Task 23: Add to top-level sample list

**Files:**
- Modify: `README.md` (repo root sample table)

- [ ] **Step 1: Add a table row in the repo root README sample list**

Find the サンプル一覧 table and add (keep column format identical to neighbors):

```markdown
| [kubevirt-provisioner](kubevirt-provisioner/) | k3s + KubeVirt + FastAPI | KubeVirt API で Ubuntu VM をプロビジョニング (Web シリアルコンソール付き) | g2l-t-8 (8GB) |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add kubevirt-provisioner to sample list"
```

## Task 24: End-to-end smoke test (manual, on a VPS)

**Files:**
- Create: `kubevirt-provisioner/tests/smoke_test.py`

This mirrors `slurm-rest-api` / `opencascade-fem`: a script you run against a deployed instance. Full KubeVirt e2e is too heavy for CI (the unit suite already runs in CI); this is the documented manual gate.

- [ ] **Step 1: Write the smoke test**

```python
# kubevirt-provisioner/tests/smoke_test.py
"""Manual e2e smoke against a deployed instance.

Usage:
    BASE_URL=https://kubevirt.example.com python tests/smoke_test.py
"""
import os
import sys
import time
import urllib.request
import json

BASE = os.environ["BASE_URL"].rstrip("/")


def _get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as r:
        return r.status, json.load(r)


def _post(path, body=None):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(
        f"{BASE}{path}", data=data, method="POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status


def main():
    assert _get("/health")[0] == 200, "health not 200"
    print("health OK")

    for _ in range(60):  # KubeVirt may take minutes
        if _get("/api/status")[1].get("available"):
            break
        time.sleep(5)
    else:
        sys.exit("KubeVirt never became available")
    print("KubeVirt available")

    assert _post("/api/vms", {"name": "smoke1", "password": "ubuntu"}) == 201
    print("VM created; waiting for Running (emulation is slow)…")

    for _ in range(120):
        vms = _get("/api/vms")[1]
        vm = next((v for v in vms if v["name"] == "smoke1"), None)
        if vm and vm["status"] == "Running":
            print(f"VM Running, ip={vm['ip']}")
            break
        time.sleep(10)
    else:
        sys.exit("VM never reached Running")

    _post("/api/vms/smoke1/stop")
    urllib.request.urlopen(
        urllib.request.Request(f"{BASE}/api/vms/smoke1", method="DELETE"), timeout=30
    )
    print("cleaned up — SMOKE PASS")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Lint (syntax only — no cluster locally)**

Run: `cd kubevirt-provisioner && python -m py_compile tests/smoke_test.py && echo OK`
Expected: `OK`.

- [ ] **Step 3: Run against a real deployment (after `conoha app deploy`)**

Run: `BASE_URL=https://<your-fqdn> python kubevirt-provisioner/tests/smoke_test.py`
Expected: ends with `SMOKE PASS`. If the console subprotocol differed in the spike, also manually confirm the browser console renders.

- [ ] **Step 4: Commit + push branch + open PR**

```bash
git add kubevirt-provisioner/tests/smoke_test.py
git commit -m "test(kubevirt-provisioner): manual e2e smoke"
git push -u origin feat/kubevirt-provisioner-sample
gh pr create --title "feat: kubevirt-provisioner sample" --body "KubeVirt + k3s + FastAPI provisioner in a single VPS. See docs/superpowers/specs/2026-06-08-kubevirt-provisioner-design.md"
```

---

## Final verification checklist

- [ ] `cd kubevirt-provisioner && python -m pytest tests/ -v` — all unit suites pass.
- [ ] `docker build .` (api) and `docker build ./bootstrap` both succeed.
- [ ] `docker compose config` validates.
- [ ] On a `g2l-t-8` VPS: `conoha app deploy` → `https://<fqdn>` serves the UI, KubeVirt reaches available, a VM reaches Running, and the browser serial console responds.
- [ ] `tests/smoke_test.py` prints `SMOKE PASS`.
- [ ] Root `README.md` lists the sample.
- [ ] `SPIKE_NOTES.md` reflects the as-built k3s flags / KubeVirt version / timings.
