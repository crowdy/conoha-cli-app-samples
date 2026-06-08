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
