import re
from pathlib import Path

from kubernetes import client, config

_SERVER_RE = re.compile(r"(?m)^(\s*server:\s*)\S+\s*$")


def rewrite_kubeconfig_server(kubeconfig_yaml: str, new_server: str) -> str:
    """Replace the single k3s cluster `server:` value (127.0.0.1) with new_server.

    k3s writes the kubeconfig with server https://127.0.0.1:6443, which is wrong
    from another container. We point it at the compose service name instead. The
    server cert must carry `k3s` in its SANs (k3s `--tls-san=k3s`).
    """
    return _SERVER_RE.sub(rf"\g<1>{new_server}", kubeconfig_yaml)


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
