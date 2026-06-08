import pytest
import yaml
from app.manifest import validate_name, build_cloud_init, MARKER


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
