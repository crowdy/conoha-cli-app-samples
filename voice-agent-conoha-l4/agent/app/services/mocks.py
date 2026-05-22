"""Deterministic in-memory mocks for non-GPU test environments."""
import json
import struct


class MockSTT:
    def __init__(self, transcript: str = "親子丼を1つ", language: str = "ja"):
        self._t = transcript
        self._l = language

    async def transcribe(self, pcm16: bytes) -> tuple[str, str]:
        return self._t, self._l


class MockLLM:
    """Always emits an add_order tool_call for any non-empty user content."""

    async def chat(self, messages, tools, tool_choice="auto"):
        last_user = next((m for m in reversed(messages) if m["role"] == "user"), None)
        if not last_user:
            return {"role": "assistant", "content": "..."}
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": "call_mock",
                "type": "function",
                "function": {
                    "name": "add_order",
                    "arguments": json.dumps({
                        "items": [{"name": "親子丼", "qty": 1}],
                        "language": "ja",
                    }),
                },
            }],
        }


class MockTTS:
    async def synthesize(self, text: str, language: str) -> bytes:
        # 100ms of silence at 24000 Hz, 16-bit mono.
        return struct.pack("<" + "h" * 2400, *([0] * 2400))
