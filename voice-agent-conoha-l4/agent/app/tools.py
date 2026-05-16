"""Tool definitions and dispatcher for the agent.

Tools are described in OpenAI-compatible JSON schema (the format vLLM
accepts via `--enable-auto-tool-choice`). Dispatch translates the LLM's
tool_call into an HTTP call against the backend.
"""
from typing import Any

import httpx

from app import settings

_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "qty": {"type": "integer", "minimum": 1},
        "note": {"type": ["string", "null"]},
    },
    "required": ["name", "qty"],
}

OPENAI_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "add_order",
            "description": "新しい注文を業務システムに追加する。",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {"type": "array", "items": _ITEM_SCHEMA},
                    "customer_label": {"type": "string"},
                    "language": {"type": "string", "enum": ["ja", "en", "ko"]},
                },
                "required": ["items", "language"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_order",
            "description": "直前の注文の数量や品目を変更する。items は変更後の全品目。",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                    "items": {"type": "array", "items": _ITEM_SCHEMA},
                    "notes": {"type": ["string", "null"]},
                },
                "required": ["order_id", "items"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "close_order",
            "description": "注文を確定する。",
            "parameters": {
                "type": "object",
                "properties": {"order_id": {"type": "string"}},
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_orders",
            "description": "当日の最近の注文を確認する。",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 10}},
                "required": [],
            },
        },
    },
]


class ToolExecutor:
    def __init__(self, mode: str, http_client: httpx.AsyncClient | None = None) -> None:
        self._mode = mode
        self._http = http_client or httpx.AsyncClient(timeout=8.0)

    @staticmethod
    def _extract_4xx(r) -> dict:
        """Parse a 4xx response body into a structured error result."""
        try:
            err = r.json()
        except Exception:
            err = {"detail": r.text}
        return {"ok": False, "error": "validation failed", "detail": err.get("detail")}

    async def dispatch(self, name: str, args: dict) -> dict:
        if name == "add_order":
            body = {
                "mode": self._mode,
                "language": args.get("language", "ja"),
                "customer_label": args.get("customer_label"),
                "items": args["items"],
            }
            r = await self._http.post(f"{settings.BACKEND_URL}/api/orders", json=body)
            if 400 <= r.status_code < 500:
                return self._extract_4xx(r)
            r.raise_for_status()
            order = r.json()
            return {"ok": True, "order_id": order["order_id"]}

        if name == "update_order":
            order_id = args["order_id"]
            body = {"items": args["items"], "notes": args.get("notes")}
            r = await self._http.patch(
                f"{settings.BACKEND_URL}/api/orders/{order_id}", json=body
            )
            if 400 <= r.status_code < 500:
                return self._extract_4xx(r)
            r.raise_for_status()
            return {"ok": True, "order_id": r.json()["order_id"]}

        if name == "close_order":
            order_id = args["order_id"]
            r = await self._http.post(
                f"{settings.BACKEND_URL}/api/orders/{order_id}/close"
            )
            if 400 <= r.status_code < 500:
                return self._extract_4xx(r)
            r.raise_for_status()
            return {"ok": True, "order_id": order_id, "status": "closed"}

        if name == "list_orders":
            limit = args.get("limit", 10)
            r = await self._http.get(
                f"{settings.BACKEND_URL}/api/orders/recent", params={"limit": limit}
            )
            r.raise_for_status()
            return r.json()

        raise ValueError(f"unknown tool: {name}")

    async def aclose(self) -> None:
        await self._http.aclose()
