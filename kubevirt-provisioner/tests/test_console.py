from app.console import console_ws_url, SUBPROTOCOL


def test_console_ws_url():
    url = console_ws_url("https://k3s:6443", "vms", "web1")
    assert url == (
        "wss://k3s:6443/apis/subresources.kubevirt.io/v1/namespaces/vms/"
        "virtualmachineinstances/web1/console"
    )


def test_subprotocol_constant():
    assert SUBPROTOCOL == "plain.kubevirt.io"
