# voice-agent-conoha-l4/agent/app/tests/test_llm_real.py
import json
import pytest

pytest.importorskip("openai", reason="openai SDK not installed — GPU host required")
from app.services.llm import VLLMService
from app.tools import OPENAI_TOOLS

pytestmark = pytest.mark.gpu


@pytest.mark.asyncio
async def test_qwen_emits_add_order_for_japanese_request():
    llm = VLLMService(base_url="http://localhost:8000/v1",
                       model="Qwen/Qwen2.5-7B-Instruct-AWQ")
    out = await llm.chat(
        messages=[
            {"role": "system",
             "content": "あなたは食堂のスタッフ。注文があれば add_order を呼ぶ。"},
            {"role": "user", "content": "親子丼を1つください"},
        ],
        tools=OPENAI_TOOLS,
        tool_choice="auto",
    )
    assert out["tool_calls"], f"expected tool_call, got: {out}"
    call = out["tool_calls"][0]["function"]
    assert call["name"] == "add_order"
    args = json.loads(call["arguments"])
    assert any("親子丼" in i["name"] for i in args["items"])
