# voice-agent-conoha-l4/agent/app/services/llm.py
from typing import Any

from openai import AsyncOpenAI


class VLLMService:
    def __init__(self, base_url: str, model: str, api_key: str = "EMPTY") -> None:
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str = "auto",
    ) -> dict[str, Any]:
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
            temperature=0.2,
            max_tokens=512,
        )
        msg = resp.choices[0].message
        out: dict[str, Any] = {"role": "assistant", "content": msg.content}
        if msg.tool_calls:
            out["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                }
                for tc in msg.tool_calls
            ]
        return out
