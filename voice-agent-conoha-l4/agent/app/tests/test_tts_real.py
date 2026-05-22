# voice-agent-conoha-l4/agent/app/tests/test_tts_real.py
import pytest

pytest.importorskip("style_bert_vits2", reason="style-bert-vits2 not installed — GPU host required")
from app.services.tts import SBV2TTSService

pytestmark = pytest.mark.gpu


@pytest.mark.asyncio
async def test_synthesize_returns_pcm():
    tts = SBV2TTSService(model_dir="/models/sbv2", device="cuda")
    pcm = await tts.synthesize("親子丼を1つ承りました。", language="ja")
    assert isinstance(pcm, bytes)
    # Roughly 1-2 s of audio @ 24kHz, 16-bit mono
    assert 20_000 < len(pcm) < 200_000
