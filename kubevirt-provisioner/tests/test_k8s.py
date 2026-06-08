from app.k8s import prepare_kubeconfig, rewrite_kubeconfig_server

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


def test_prepare_kubeconfig_writes_rewritten_copy(tmp_path):
    src = tmp_path / "src.yaml"
    src.write_text(SAMPLE)
    dst = tmp_path / "out.yaml"
    prepare_kubeconfig(str(src), str(dst), "https://k3s:6443")
    text = dst.read_text()
    assert "server: https://k3s:6443" in text
