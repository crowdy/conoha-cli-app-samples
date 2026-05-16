# voice-agent-conoha-l4/agent/app/services/stt.py
import asyncio
import io

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel


class WhisperSTTService:
    def __init__(self, model_size: str = "medium", device: str = "cuda") -> None:
        self._model = WhisperModel(model_size, device=device, compute_type="float16")

    async def transcribe(self, pcm16: bytes) -> tuple[str, str]:
        return await asyncio.get_event_loop().run_in_executor(
            None, self._transcribe_sync, pcm16
        )

    def _transcribe_sync(self, pcm16: bytes) -> tuple[str, str]:
        audio = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
        segments, info = self._model.transcribe(
            audio, language=None, beam_size=1, vad_filter=False
        )
        text = "".join(s.text for s in segments).strip()
        return text, info.language
