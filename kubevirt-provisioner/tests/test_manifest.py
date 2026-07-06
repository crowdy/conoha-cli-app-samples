import pytest
import yaml
from app.manifest import validate_name, build_cloud_init, build_vm, MARKER


@pytest.mark.parametrize("name", ["vm1", "my-ubuntu", "a", "a1-b2-c3"])
def test_validate_name_accepts_valid(name):
    validate_name(name)  # must not raise


@pytest.mark.parametrize("name", ["", "-leads", "trails-", "UPPER", "has_underscore", "a" * 41, "spa ce"])
def test_validate_name_rejects_invalid(name):
    with pytest.raises(ValueError):
        validate_name(name)


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
