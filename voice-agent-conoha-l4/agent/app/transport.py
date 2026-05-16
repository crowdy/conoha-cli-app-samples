"""WebRTC offer/answer handshake via aiortc.

Phase C: establishes a PeerConnection and handles SDP exchange.
Phase D (Task 24): full VoicePipeline wiring with Silero VAD is added in
this module, with pipeline imported lazily inside handle_offer to avoid
pulling in torch/av at module-load time (which would break non-GPU tests).
"""
import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Callable

from aiortc import RTCPeerConnection, RTCSessionDescription

logger = logging.getLogger(__name__)


@dataclass
class OfferResult:
    sdp: str
    type: str
    session_id: str


class WebRTCNegotiator:
    """Per-app singleton that holds active PeerConnections."""

    def __init__(self, services_factory: Callable | None = None) -> None:
        self._pcs: dict[str, RTCPeerConnection] = {}
        self._pipelines: dict = {}
        self._services_factory = services_factory  # callable → (stt, llm, tts)

    async def handle_offer(self, sdp: str, sdp_type: str, mode: str = "callcenter") -> OfferResult:
        # Lazy import: VoicePipeline pulls in torch + av which are GPU-only.
        # Importing at module level would break non-GPU test collection.
        from app.pipeline import VoicePipeline  # noqa: PLC0415
        from app.loop import ConversationLoop  # noqa: PLC0415

        pc = RTCPeerConnection()
        sid = uuid.uuid4().hex

        stt, llm, tts = self._services_factory() if self._services_factory else (None, None, None)
        conv = ConversationLoop(mode=mode, stt=stt, llm=llm, tts=tts)
        dc = pc.createDataChannel("ui-events")

        def emit(event: dict) -> None:
            if dc.readyState == "open":
                dc.send(json.dumps(event))

        pipeline = VoicePipeline(conv, emit=emit)
        pc.addTrack(pipeline.outbound_track())

        @pc.on("track")
        def on_track(track):
            if track.kind == "audio":
                asyncio.create_task(pipeline.handle_inbound_track(track))

        @pc.on("connectionstatechange")
        async def on_state():
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self.close(sid)

        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=sdp_type))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        self._pcs[sid] = pc
        self._pipelines[sid] = pipeline
        return OfferResult(sdp=pc.localDescription.sdp, type=pc.localDescription.type,
                           session_id=sid)

    async def close(self, session_id: str) -> None:
        pc = self._pcs.pop(session_id, None)
        self._pipelines.pop(session_id, None)
        if pc is not None:
            await pc.close()

    async def close_all(self) -> None:
        for pc in list(self._pcs.values()):
            await pc.close()
        self._pcs.clear()
        self._pipelines.clear()
