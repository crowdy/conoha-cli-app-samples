"""OpenAI Realtime API function tool definitions.

These are returned verbatim inside the /api/realtime/session response and
sent by the browser in session.update. Tool calls are executed in the
browser (see frontend/lib/tools.ts), which then calls the backend HTTP API.
"""

_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "qty": {"type": "integer", "minimum": 1},
        "note": {"type": ["string", "null"]},
    },
    "required": ["name", "qty"],
}

TOOLS = [
    {
        "type": "function",
        "name": "add_order",
        "description": (
            "新しい注文を業務システムに追加する。お客様が注文した品目と数量を "
            "items 配列にすべて含めること。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": _ITEM_SCHEMA},
                "customer_label": {
                    "type": "string",
                    "description": "席・現場の呼称。モードに応じた言い回しを採用",
                },
                "language": {"type": "string", "enum": ["ja", "en", "ko"]},
            },
            "required": ["items", "language"],
        },
    },
    {
        "type": "function",
        "name": "update_order",
        "description": "直前の注文の数量や品目を変更する。items は差分ではなく変更後の全品目。",
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
    {
        "type": "function",
        "name": "close_order",
        "description": "注文を確定する。お礼の言葉の直前に呼ぶこと。",
        "parameters": {
            "type": "object",
            "properties": {"order_id": {"type": "string"}},
            "required": ["order_id"],
        },
    },
    {
        "type": "function",
        "name": "list_orders",
        "description": "当日の最近の注文を確認する(使用頻度低、復旧用)。",
        "parameters": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "default": 10}},
            "required": [],
        },
    },
]
