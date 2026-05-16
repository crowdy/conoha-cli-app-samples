"""Pure conversation loop: STT → LLM (with tool execution) → TTS.

GPU services and aiortc audio plumbing are injected, so this module can
be unit-tested without either. The Pipecat/WebRTC adapter wraps a
single instance of this loop per session.
"""
import json
import logging
from typing import Any, Callable

from app.personas import resolve
from app.services.interfaces import LLM, STT, TTS
from app.tools import OPENAI_TOOLS, ToolExecutor

logger = logging.getLogger(__name__)


class ConversationLoop:
    def __init__(
        self,
        mode: str,
        stt: STT,
        llm: LLM,
        tts: TTS,
        tool_executor: ToolExecutor | None = None,
    ) -> None:
        self._mode, system_prompt = resolve(mode)
        self._history: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._exec = tool_executor or ToolExecutor(mode=self._mode)

    async def turn(
        self,
        pcm16: bytes,
        emit: Callable[[dict[str, Any]], None],
    ) -> bytes:
        text, lang = await self._stt.transcribe(pcm16)
        if not text.strip():
            audio = await self._tts.synthesize(
                "もう一度お願いします。", language="ja"
            )
            emit({"type": "empty_transcript"})
            return audio

        emit({"type": "user_transcript", "text": text, "language": lang})
        self._history.append({"role": "user", "content": text})

        assistant_msg = await self._llm.chat(
            messages=self._history, tools=OPENAI_TOOLS, tool_choice="auto"
        )
        self._history.append(assistant_msg)

        if assistant_msg.get("tool_calls"):
            for call in assistant_msg["tool_calls"]:
                name = call["function"]["name"]
                args = json.loads(call["function"]["arguments"])
                emit({"type": "tool_call", "name": name, "args": args})
                try:
                    result = await self._exec.dispatch(name, args)
                    if name == "add_order" and result.get("ok"):
                        emit({
                            "type": "order_persisted",
                            "order_id": result["order_id"],
                        })
                except Exception:
                    logger.exception("tool dispatch failed")
                    result = {"ok": False, "error": "tool execution failed"}
                    emit({"type": "error", "detail": "tool execution failed"})
                self._history.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps(result),
                })

            final = await self._llm.chat(
                messages=self._history, tools=OPENAI_TOOLS, tool_choice="none"
            )
            self._history.append(final)
            content = final.get("content") or ""
        else:
            content = assistant_msg.get("content") or ""

        if content:
            emit({"type": "assistant_text", "text": content})
        return await self._tts.synthesize(content or "...", language=lang)
