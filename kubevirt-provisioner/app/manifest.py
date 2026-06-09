import re
import yaml

# RFC 1123 label, capped at 40 chars to keep generated resource names short.
_NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$")

MARKER = "kubevirt-provisioner-ready"
MANAGED_BY = "kubevirt-provisioner"


def validate_name(name: str) -> None:
    """Raise ValueError if name is not a valid DNS-1123-ish VM name (<=40 chars)."""
    if not _NAME_RE.match(name):
        raise ValueError(
            "name must match [a-z0-9-], start/end alphanumeric, 1-40 chars"
        )


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
            # `running` is deprecated in favour of `runStrategy` in recent KubeVirt
            # but still supported in v1.4.0 and simplest for this demo's start/stop.
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
