import pytest

from app.tools import OPENAI_TOOLS, ToolExecutor


pytestmark = pytest.mark.asyncio


async def test_add_order(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders",
        method="POST",
        json={"order_id": "ord_abc", "items": [{"name": "x", "qty": 1}],
              "mode": "callcenter", "language": "ja", "customer_label": None,
              "notes": None, "status": "persisted",
              "created_at": "t", "updated_at": "t"},
    )
    ex = ToolExecutor(mode="callcenter")
    out = await ex.dispatch("add_order", {
        "items": [{"name": "x", "qty": 1}],
        "language": "ja",
    })
    assert out["ok"] is True
    assert out["order_id"] == "ord_abc"


async def test_update_order_passes_id(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders/ord_abc",
        method="PATCH",
        json={"order_id": "ord_abc", "items": [{"name": "y", "qty": 2}],
              "mode": "callcenter", "language": "ja", "customer_label": None,
              "notes": "n", "status": "persisted",
              "created_at": "t", "updated_at": "t"},
    )
    ex = ToolExecutor(mode="callcenter")
    out = await ex.dispatch("update_order", {
        "order_id": "ord_abc",
        "items": [{"name": "y", "qty": 2}], "notes": "n",
    })
    assert out["ok"] is True


async def test_close_order(httpx_mock):
    httpx_mock.add_response(
        url="http://backend:8000/api/orders/ord_abc/close",
        method="POST",
        json={"order_id": "ord_abc", "items": [], "mode": "callcenter",
              "language": "ja", "customer_label": None, "notes": None,
              "status": "closed", "created_at": "t", "updated_at": "t"},
    )
    ex = ToolExecutor(mode="callcenter")
    out = await ex.dispatch("close_order", {"order_id": "ord_abc"})
    assert out["status"] == "closed"


async def test_unknown_tool_raises():
    ex = ToolExecutor(mode="callcenter")
    with pytest.raises(ValueError):
        await ex.dispatch("hack", {})


def test_openai_tools_shape():
    names = {t["function"]["name"] for t in OPENAI_TOOLS}
    assert names == {"add_order", "update_order", "close_order", "list_orders"}
