def _create(client, **overrides):
    payload = {
        "mode": "emergency",
        "customer_label": "現場 α",
        "language": "ja",
        "items": [{"name": "カルボナーラ", "qty": 2}],
    }
    payload.update(overrides)
    return client.post("/api/orders", json=payload)


def test_create_order_appends_to_sheets_and_broadcasts(client, app):
    res = _create(client)
    assert res.status_code == 201
    order = res.json()
    assert order["order_id"].startswith("ord_")
    assert order["status"] == "open"

    assert len(app.state.sheets.appended) == 1
    assert app.state.sheets.appended[0][0] == order["order_id"]

    history = app.state.hub.history()
    assert history[-1]["type"] == "order_added"
    assert history[-1]["payload"]["order_id"] == order["order_id"]


def test_create_order_sheets_failure_returns_502_and_rolls_back(client, app):
    app.state.sheets.fail = True
    res = _create(client)
    assert res.status_code == 502
    assert app.state.hub.history() == []
    assert app.state.store.recent(10) == []


def test_update_order_replaces_items(client, app):
    order = _create(client).json()
    res = client.patch(
        f"/api/orders/{order['order_id']}",
        json={"items": [{"name": "カルボナーラ", "qty": 3}], "notes": "3つに変更"},
    )
    assert res.status_code == 200
    assert res.json()["items"][0]["qty"] == 3
    assert len(app.state.sheets.updated) == 1
    assert app.state.hub.history()[-1]["type"] == "order_updated"


def test_update_unknown_order_returns_404(client):
    res = client.patch(
        "/api/orders/ord_missing", json={"items": [{"name": "x", "qty": 1}]}
    )
    assert res.status_code == 404


def test_close_order_sets_status_closed(client, app):
    order = _create(client).json()
    res = client.post(f"/api/orders/{order['order_id']}/close")
    assert res.status_code == 200
    assert res.json()["status"] == "closed"
    assert app.state.hub.history()[-1]["type"] == "order_closed"


def test_close_unknown_order_returns_404(client):
    res = client.post("/api/orders/ord_missing/close")
    assert res.status_code == 404


def test_recent_orders_returns_last_n(client):
    for i in range(4):
        _create(client, items=[{"name": f"品{i}", "qty": 1}])
    res = client.get("/api/orders/recent?limit=2")
    assert res.status_code == 200
    assert len(res.json()["orders"]) == 2


def test_update_order_sheets_failure_rolls_back(client, app):
    order = _create(client).json()
    original_qty = order["items"][0]["qty"]

    app.state.sheets.fail_update = True
    res = client.patch(
        f"/api/orders/{order['order_id']}",
        json={"items": [{"name": "カルボナーラ", "qty": 99}], "notes": "fail"},
    )
    assert res.status_code == 502

    # In-memory store reverted to pre-update state.
    stored = app.state.store.get(order["order_id"])
    assert stored.items[0].qty == original_qty
    assert stored.notes is None

    # No order_updated broadcast (we rolled back before publishing).
    types = [evt["type"] for evt in app.state.hub.history()]
    assert "order_updated" not in types


def test_close_order_sheets_failure_rolls_back(client, app):
    order = _create(client).json()

    app.state.sheets.fail_update = True
    res = client.post(f"/api/orders/{order['order_id']}/close")
    assert res.status_code == 502

    stored = app.state.store.get(order["order_id"])
    assert stored.status == "open"  # rolled back

    types = [evt["type"] for evt in app.state.hub.history()]
    assert "order_closed" not in types
