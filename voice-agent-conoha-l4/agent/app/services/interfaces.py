"""Protocol interfaces — mock and real implementations satisfy these."""
from typing import Any, Protocol


class STT(Protocol):
    async def transcribe(self, pcm16: bytes) -> tuple[str, str]:
        """Return (text, detected_language)."""


class LLM(Protocol):
    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        tool_choice: str = "auto",
    ) -> dict[str, Any]:
        """Return an OpenAI-shape assistant message dict."""


class TTS(Protocol):
    async def synthesize(self, text: str, language: str) -> bytes:
        """Return 16-bit PCM mono @ 24000 Hz."""
