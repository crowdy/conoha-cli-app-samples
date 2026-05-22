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
from typing import Any, Callable

from aiortc import RTCPeerConnection, RTCSessionDescription

from app import settings

logger = logging.getLogger(__name__)


@dataclass
class OfferResult:
    sdp: str
    type: str
    session_id: str


class WebRTCNegotiator:
    """Per-app singleton that holds active PeerConnections."""

    def __init__(
        self,
        services_factory: Callable | None = None,
        release_cb: Callable[[str], None] | None = None,
    ) -> None:
        self._pcs: dict[str, RTCPeerConnection] = {}
        self._pipelines: dict = {}
        self._timeout_tasks: dict[str, asyncio.Task] = {}
        self._services_factory = services_factory  # callable → (stt, llm, tts)
        self._release_cb = release_cb

    async def _enforce_timeout(self, sid: str) -> None:
        try:
            await asyncio.sleep(settings.SESSION_MAX_DURATION_SEC)
        except asyncio.CancelledError:
            return
        if sid in self._pcs:
            logger.info("session %s hit max duration, closing", sid)
            await self.close(sid)

    async def handle_offer(self, sdp: str, sdp_type: str, mode: str = "callcenter") -> OfferResult:
        # Lazy import: VoicePipeline pulls in torch + av which are GPU-only.
        # Importing at module level would break non-GPU test collection.
        from app.pipeline import VoicePipeline  # noqa: PLC0415
        from app.loop import ConversationLoop  # noqa: PLC0415

        pc = RTCPeerConnection()
        sid = uuid.uuid4().hex

        stt, llm, tts = self._services_factory() if self._services_factory else (None, None, None)
        conv = ConversationLoop(mode=mode, stt=stt, llm=llm, tts=tts)

        # I-6: Client creates the data channel in their offer. We wait for it.
        dc_ref: dict[str, Any] = {"dc": None}

        @pc.on("datachannel")
        def on_datachannel(channel):
            dc_ref["dc"] = channel

        def emit(event: dict) -> None:
            dc = dc_ref["dc"]
            if dc is not None and dc.readyState == "open":
                try:
                    dc.send(json.dumps(event))
                except Exception:
                    logger.exception("DC send failed")

        pipeline = VoicePipeline(conv, emit=emit)
        pc.addTrack(pipeline.outbound_track())

        @pc.on("track")
        def on_track(track):
            if track.kind == "audio":
                task = asyncio.create_task(pipeline.handle_inbound_track(track))
                pipeline.bg_tasks.add(task)
                task.add_done_callback(pipeline.bg_tasks.discard)

        @pc.on("connectionstatechange")
        async def on_state():
            if pc.connectionState in ("failed", "closed", "disconnected"):
                await self.close(sid)

        await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=sdp_type))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        self._pcs[sid] = pc
        self._pipelines[sid] = pipeline
        # C-2: schedule hard timeout per session
        self._timeout_tasks[sid] = asyncio.create_task(self._enforce_timeout(sid))
        return OfferResult(sdp=pc.localDescription.sdp, type=pc.localDescription.type,
                           session_id=sid)

    async def close(self, session_id: str) -> None:
        pipeline = self._pipelines.pop(session_id, None)
        pc = self._pcs.pop(session_id, None)
        # C-2: cancel the timeout task
        task = self._timeout_tasks.pop(session_id, None)
        if task and not task.done():
            task.cancel()
        # I-1: tear down the pipeline (closes httpx client)
        if pipeline is not None:
            try:
                await pipeline.aclose()
            except Exception:
                logger.exception("pipeline aclose failed")
        if pc is not None:
            await pc.close()
        # C-1: release the session registry slot
        if self._release_cb is not None:
            self._release_cb(session_id)

    async def close_all(self) -> None:
        for sid in list(self._pcs):
            if self._release_cb is not None:
                self._release_cb(sid)
        for pc in list(self._pcs.values()):
            await pc.close()
        self._pcs.clear()
        self._pipelines.clear()
        for task in list(self._timeout_tasks.values()):
            task.cancel()
        self._timeout_tasks.clear()
