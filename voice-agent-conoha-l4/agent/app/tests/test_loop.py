import json

import pytest

from app.loop import ConversationLoop
from app.services.mocks import MockLLM, MockSTT, MockTTS

pytestmark = pytest.mark.asyncio


class CapturingLLM(MockLLM):
    """LLM that emits tool_call on first turn, plain text on second."""
    def __init__(self):
        self._call = 0
        self.captured_messages = []

    async def chat(self, messages, tools, tool_choice="auto"):
        self.captured_messages.append(list(messages))
        self._call += 1
        if self._call == 1:
            return await super().chat(messages, tools, tool_choice)
        return {"role": "assistant",
                "content": "親子丼を1つ承りました。10 分ほどお待ちください。"}


async def test_loop_runs_tool_then_final_answer(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders",
        method="POST",
        json={"order_id": "ord_xyz", "items": [{"name": "親子丼", "qty": 1}],
              "mode": "callcenter", "language": "ja", "customer_label": None,
              "notes": None, "status": "persisted",
              "created_at": "t", "updated_at": "t"},
    )
    llm = CapturingLLM()
    loop = ConversationLoop(
        mode="callcenter", stt=MockSTT(), llm=llm, tts=MockTTS(),
    )
    events = []
    audio = await loop.turn(pcm16=b"\x00\x00", emit=events.append)
    assert isinstance(audio, bytes) and len(audio) > 0
    types = [e["type"] for e in events]
    assert "user_transcript" in types
    assert "tool_call" in types
    assert "order_persisted" in types
    # LLM was called twice: once for tool decision, once for final response.
    assert len(llm.captured_messages) == 2
    # Second call must include tool_result message.
    tool_msgs = [m for m in llm.captured_messages[1] if m["role"] == "tool"]
    assert len(tool_msgs) == 1
    assert json.loads(tool_msgs[0]["content"])["order_id"] == "ord_xyz"
