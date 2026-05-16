# voice-agent-conoha-l4/agent/app/pipeline.py
"""Glues WebRTC audio I/O to ConversationLoop using Silero VAD for
turn detection.

Inbound audio frames arrive at 48 kHz (Opus default). We resample to
16 kHz mono for Whisper. Outbound audio from TTS arrives at 24 kHz; we
upsample to 48 kHz for the WebRTC AudioStreamTrack.
"""
import asyncio
import fractions
import logging
from typing import Callable

import av
import numpy as np
import torch
from aiortc.mediastreams import AudioStreamTrack
from aiortc.contrib.media import MediaStreamError

from app.loop import ConversationLoop

logger = logging.getLogger(__name__)
_SILERO_REPO = "snakers4/silero-vad"


class _OutboundTrack(AudioStreamTrack):
    """Audio track fed from an asyncio.Queue of 48 kHz int16 PCM chunks."""

    def __init__(self) -> None:
        super().__init__()
        self._queue: asyncio.Queue[np.ndarray] = asyncio.Queue()
        self._pts = 0

    async def push(self, pcm48k_int16: np.ndarray) -> None:
        await self._queue.put(pcm48k_int16)

    async def recv(self):
        try:
            data = await asyncio.wait_for(self._queue.get(), timeout=0.05)
        except asyncio.TimeoutError:
            # Emit 20 ms of silence so the track stays alive.
            data = np.zeros(960, dtype=np.int16)
        frame = av.AudioFrame.from_ndarray(data.reshape(1, -1), format="s16",
                                            layout="mono")
        frame.sample_rate = 48000
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, 48000)
        self._pts += data.shape[-1]
        return frame


def _resample_int16(pcm: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return pcm
    import librosa
    f = pcm.astype(np.float32) / 32768.0
    f = librosa.resample(f, orig_sr=src_sr, target_sr=dst_sr)
    return (np.clip(f, -1.0, 1.0) * 32767).astype(np.int16)


class VoicePipeline:
    """One per session. Owns the VAD state and the ConversationLoop."""

    SILENCE_THRESHOLD_SEC = 0.6
    MAX_UTTERANCE_SEC = 20.0
    VAD_PROB_THRESHOLD = 0.5

    def __init__(self, loop: ConversationLoop, emit: Callable[[dict], None]) -> None:
        self._loop = loop
        self._emit = emit
        self._buf: list[np.ndarray] = []
        self._speech_active = False
        self._silence_samples = 0
        self._out_track = _OutboundTrack()
        self.bg_tasks: set[asyncio.Task] = set()
        # Silero VAD operates on 32 ms chunks (512 samples at 16 kHz, Silero requirement)
        self._vad_model, _ = torch.hub.load(repo_or_dir=_SILERO_REPO,
                                              model="silero_vad", trust_repo=True)

    def outbound_track(self) -> _OutboundTrack:
        return self._out_track

    async def handle_inbound_track(self, track) -> None:
        try:
            while True:
                frame = await track.recv()
                arr = frame.to_ndarray()
                if arr.ndim > 1:
                    arr = arr.mean(axis=0).astype(np.int16)
                pcm16k = _resample_int16(arr, frame.sample_rate, 16000)
                await self._process_chunk(pcm16k)
        except MediaStreamError:
            return

    async def _process_chunk(self, pcm16k: np.ndarray) -> None:
        self._buf.append(pcm16k)
        total_samples = sum(a.size for a in self._buf)
        if total_samples / 16000 >= self.MAX_UTTERANCE_SEC:
            await self._flush_utterance()
            return
        # Run VAD on the most recent 32 ms (512 samples at 16 kHz, Silero requirement)
        recent = pcm16k[-512:] if pcm16k.size >= 512 else pcm16k
        if recent.size < 512:
            return
        tensor = torch.from_numpy(recent.astype(np.float32) / 32768.0)
        prob = float(self._vad_model(tensor, 16000).item())

        if prob >= self.VAD_PROB_THRESHOLD:
            self._speech_active = True
            self._silence_samples = 0
        elif self._speech_active:
            self._silence_samples += recent.size
            if self._silence_samples / 16000 >= self.SILENCE_THRESHOLD_SEC:
                await self._flush_utterance()

    async def _flush_utterance(self) -> None:
        if not self._buf:
            return
        utterance = np.concatenate(self._buf)
        self._buf = []
        self._speech_active = False
        self._silence_samples = 0
        try:
            pcm24k_out = await self._loop.turn(
                pcm16=utterance.tobytes(), emit=self._emit
            )
        except Exception:
            logger.exception("conversation turn failed")
            self._emit({"type": "error", "detail": "turn failed"})
            return
        arr24k = np.frombuffer(pcm24k_out, dtype=np.int16)
        arr48k = _resample_int16(arr24k, 24000, 48000)
        # Push in 20 ms chunks (960 samples @ 48 kHz)
        chunk = 960
        for i in range(0, arr48k.size, chunk):
            await self._out_track.push(arr48k[i:i + chunk])
