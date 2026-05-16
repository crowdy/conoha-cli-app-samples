# voice-agent-conoha-l4/backend/app/tests/test_store.py
from app.models import Order, OrderItem
from app.store import OrderStore


def _make(oid: str = "ord_1") -> Order:
    return Order(
        order_id=oid, mode="callcenter", language="ja", customer_label=None,
        items=[OrderItem(name="x", qty=1)], notes=None,
        status="pending", created_at="t", updated_at="t",
    )


def test_create_and_get():
    s = OrderStore()
    order = s.create(_make("ord_a"))
    assert s.get("ord_a") == order


def test_update_replaces_items():
    s = OrderStore()
    s.create(_make("ord_b"))
    updated = s.update("ord_b", items=[OrderItem(name="y", qty=3)], notes="n")
    assert updated.items[0].name == "y"
    assert updated.notes == "n"


def test_close_sets_status():
    s = OrderStore()
    s.create(_make("ord_c"))
    closed = s.close("ord_c")
    assert closed.status == "closed"


def test_recent_returns_in_reverse_order():
    s = OrderStore()
    s.create(_make("ord_1"))
    s.create(_make("ord_2"))
    recent = s.recent(limit=10)
    assert [o.order_id for o in recent] == ["ord_2", "ord_1"]


def test_delete_removes():
    s = OrderStore()
    s.create(_make("ord_x"))
    s.delete("ord_x")
    assert s.get("ord_x") is None
