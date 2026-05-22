import pytest

from app.services.mocks import MockLLM, MockSTT, MockTTS

pytestmark = pytest.mark.asyncio


async def test_mock_stt_returns_canned_text():
    stt = MockSTT(transcript="親子丼を1つ")
    assert await stt.transcribe(b"\x00\x00") == ("親子丼を1つ", "ja")


async def test_mock_llm_emits_add_order_tool_call():
    llm = MockLLM()
    msgs = [{"role": "user", "content": "親子丼を1つ"}]
    out = await llm.chat(messages=msgs, tools=[], tool_choice="auto")
    assert out["tool_calls"][0]["function"]["name"] == "add_order"


async def test_mock_tts_returns_pcm_bytes():
    tts = MockTTS()
    data = await tts.synthesize("おはよう", language="ja")
    assert isinstance(data, bytes) and len(data) > 0
