import ssl
from typing import Awaitable, Callable

# Confirmed in the Phase A spike. KubeVirt streams the serial console as a
# binary WebSocket negotiated with this subprotocol.
SUBPROTOCOL = "plain.kubevirt.io"


def console_ws_url(api_server: str, namespace: str, name: str) -> str:
    """Build the KubeVirt serial-console WebSocket URL (https:// -> wss://)."""
    base = api_server.replace("https://", "wss://").replace("http://", "ws://")
    return (
        f"{base}/apis/subresources.kubevirt.io/v1/namespaces/{namespace}/"
        f"virtualmachineinstances/{name}/console"
    )


def build_ssl_context(ca_cert: str, client_cert: str, client_key: str) -> ssl.SSLContext:
    """SSL context that trusts the cluster CA and presents the admin client cert."""
    ctx = ssl.create_default_context(cafile=ca_cert)
    ctx.load_cert_chain(certfile=client_cert, keyfile=client_key)
    return ctx


async def pump(source, send: Callable[[bytes], Awaitable[None]]) -> None:
    """Forward every chunk from an async-iterable source to send()."""
    async for chunk in source:
        await send(chunk)
