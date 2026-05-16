"""WebRTC offer/answer handshake via aiortc.

The actual audio<->ConversationLoop wiring is plugged in by Phase D. For
Phase C this module just establishes a PeerConnection, opens a
DataChannel, and immediately closes it — enough to verify the wire
contract from the frontend side.
"""
import logging
import uuid
from dataclasses import dataclass

from aiortc import RTCPeerConnection, RTCSessionDescription

logger = logging.getLogger(__name__)


@dataclass
class OfferResult:
    sdp: str
    type: str
    session_id: str


class WebRTCNegotiator:
    """Per-app singleton that holds active PeerConnections."""

    def __init__(self) -> None:
        self._pcs: dict[str, RTCPeerConnection] = {}

    async def handle_offer(self, sdp: str, sdp_type: str) -> OfferResult:
        pc = RTCPeerConnection()
        sid = uuid.uuid4().hex

        @pc.on("connectionstatechange")
        async def on_state():
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self.close(sid)

        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=sdp_type))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        self._pcs[sid] = pc
        return OfferResult(sdp=pc.localDescription.sdp, type=pc.localDescription.type,
                           session_id=sid)

    async def close(self, session_id: str) -> None:
        pc = self._pcs.pop(session_id, None)
        if pc is not None:
            await pc.close()

    async def close_all(self) -> None:
        for pc in list(self._pcs.values()):
            await pc.close()
        self._pcs.clear()
