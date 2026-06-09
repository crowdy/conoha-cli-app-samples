import base64
import re
from pathlib import Path

import yaml
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


def extract_cluster_tls(kubeconfig_yaml: str, dest_dir: str) -> tuple[str, str, str]:
    """Decode the cluster CA + admin client cert/key (base64 *-data fields) from a
    kubeconfig string into files under dest_dir. Returns (ca, cert, key) paths.

    Used to build the SSL context for the KubeVirt console WebSocket (client-cert
    auth) — proven in the Phase A spike to authenticate through the aggregated
    virt-api. More robust than reaching into Configuration.get_default_copy().
    """
    kc = yaml.safe_load(kubeconfig_yaml)
    cluster = kc["clusters"][0]["cluster"]
    user = kc["users"][0]["user"]

    def _write(name: str, b64: str) -> str:
        path = Path(dest_dir) / name
        path.write_bytes(base64.b64decode(b64))
        return str(path)

    ca = _write("cluster-ca.crt", cluster["certificate-authority-data"])
    cert = _write("client.crt", user["client-certificate-data"])
    key = _write("client.key", user["client-key-data"])
    return ca, cert, key
