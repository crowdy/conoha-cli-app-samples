# voice-agent-conoha-l4/agent/app/tests/test_stt_real.py
"""
Fixture is a 3-second silence placeholder.
Replace with a real recording before running on a GPU host.
The test assertion ("親子" in text or "親子丼" in text) will not pass
against silence — this is expected; the test is gpu-marked and skipped
in non-GPU environments.
"""
from pathlib import Path

import pytest

pytest.importorskip("faster_whisper", reason="faster-whisper not installed — GPU host required")
import soundfile as sf

from app.services.stt import WhisperSTTService

pytestmark = pytest.mark.gpu


@pytest.mark.asyncio
async def test_japanese_transcription():
    wav_path = Path(__file__).parent / "fixtures" / "oyakodon_ja.wav"
    data, sr = sf.read(wav_path, dtype="int16")
    assert sr == 16000
    stt = WhisperSTTService(model_size="medium", device="cuda")
    text, lang = await stt.transcribe(data.tobytes())
    assert "親子" in text or "親子丼" in text
    assert lang == "ja"
