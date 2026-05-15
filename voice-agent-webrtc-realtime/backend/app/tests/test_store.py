from app.models import OrderItem
from app.store import OrderStore


def _items():
    return [OrderItem(name="カルボナーラ", qty=2)]


def test_create_assigns_id_and_open_status():
    store = OrderStore()
    order = store.create("emergency", "現場 α", "ja", _items())
    assert order.order_id.startswith("ord_")
    assert order.status == "open"
    assert order.mode == "emergency"
    assert order.items[0].name == "カルボナーラ"


def test_get_returns_created_order():
    store = OrderStore()
    order = store.create("callcenter", None, "ja", _items())
    assert store.get(order.order_id) is order


def test_get_unknown_returns_none():
    assert OrderStore().get("ord_missing") is None


def test_update_replaces_items_and_notes():
    store = OrderStore()
    order = store.create("military", None, "ja", _items())
    updated = store.update(
        order.order_id, [OrderItem(name="ピザ", qty=1)], "変更しました"
    )
    assert updated.items[0].name == "ピザ"
    assert updated.notes == "変更しました"
    assert store.get(order.order_id).items[0].name == "ピザ"


def test_close_sets_status():
    store = OrderStore()
    order = store.create("callcenter", None, "ja", _items())
    closed = store.close(order.order_id)
    assert closed.status == "closed"


def test_delete_removes_order():
    store = OrderStore()
    order = store.create("callcenter", None, "ja", _items())
    store.delete(order.order_id)
    assert store.get(order.order_id) is None


def test_recent_returns_last_n_in_order():
    store = OrderStore()
    ids = [store.create("callcenter", None, "ja", _items()).order_id for _ in range(5)]
    recent = store.recent(3)
    assert [o.order_id for o in recent] == ids[-3:]
