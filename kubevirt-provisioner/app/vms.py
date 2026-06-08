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
