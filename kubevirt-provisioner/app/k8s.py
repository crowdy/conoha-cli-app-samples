import re

_SERVER_RE = re.compile(r"(?m)^(\s*server:\s*)\S+\s*$")


def rewrite_kubeconfig_server(kubeconfig_yaml: str, new_server: str) -> str:
    """Replace the single k3s cluster `server:` value (127.0.0.1) with new_server.

    k3s writes the kubeconfig with server https://127.0.0.1:6443, which is wrong
    from another container. We point it at the compose service name instead. The
    server cert must carry `k3s` in its SANs (k3s `--tls-san=k3s`).
    """
    return _SERVER_RE.sub(rf"\g<1>{new_server}", kubeconfig_yaml)
