import pytest
from app.console import console_ws_url, pump, SUBPROTOCOL


def test_console_ws_url():
    url = console_ws_url("https://k3s:6443", "vms", "web1")
    assert url == (
        "wss://k3s:6443/apis/subresources.kubevirt.io/v1/namespaces/vms/"
        "virtualmachineinstances/web1/console"
    )


def test_subprotocol_constant():
    assert SUBPROTOCOL == "plain.kubevirt.io"


class FakeSource:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    async def __aiter__(self):
        for c in self._chunks:
            yield c


class FakeSink:
    def __init__(self):
        self.received = []

    async def send(self, data):
        self.received.append(data)


@pytest.mark.asyncio
async def test_pump_forwards_all_chunks():
    src = FakeSource([b"hello", b"world"])
    sink = FakeSink()
    await pump(src, sink.send)
    assert sink.received == [b"hello", b"world"]
