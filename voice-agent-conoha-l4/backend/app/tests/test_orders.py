# voice-agent-conoha-l4/backend/app/tests/test_orders.py
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.events import EventBroker
from app.routers.orders import router
from app.store import OrderStore


@pytest.fixture
def app():
    a = FastAPI()
    a.state.store = OrderStore()
    a.state.broker = EventBroker()
    a.state.sheets = MagicMock()
    a.state.sheets.find_row.return_value = 2
    a.include_router(router)
    return TestClient(a)


def _payload():
    return {
        "mode": "callcenter", "language": "ja", "customer_label": None,
        "items": [{"name": "親子丼", "qty": 1}],
    }


def test_create_order_appends_to_sheets(app):
    r = app.post("/api/orders", json=_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["order_id"].startswith("ord_")
    assert body["items"][0]["name"] == "親子丼"
    app.app.state.sheets.append_order.assert_called_once()


def test_create_order_rolls_back_on_sheets_failure(app):
    app.app.state.sheets.append_order.side_effect = RuntimeError("network")
    r = app.post("/api/orders", json=_payload())
    assert r.status_code == 502
    assert len(app.app.state.store.recent()) == 0


def test_update_order_modifies_items(app):
    created = app.post("/api/orders", json=_payload()).json()
    r = app.patch(f"/api/orders/{created['order_id']}",
                  json={"items": [{"name": "親子丼", "qty": 2}], "notes": "x"})
    assert r.status_code == 200
    assert r.json()["items"][0]["qty"] == 2


def test_close_order_sets_status(app):
    created = app.post("/api/orders", json=_payload()).json()
    r = app.post(f"/api/orders/{created['order_id']}/close")
    assert r.status_code == 200
    assert r.json()["status"] == "closed"


def test_recent_orders(app):
    app.post("/api/orders", json=_payload())
    app.post("/api/orders", json=_payload())
    r = app.get("/api/orders/recent?limit=5")
    assert len(r.json()["orders"]) == 2


def test_invalid_mode_rejected(app):
    bad = _payload() | {"mode": "intergalactic"}
    assert app.post("/api/orders", json=bad).status_code == 422
