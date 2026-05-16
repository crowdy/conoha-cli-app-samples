# voice-agent-conoha-l4/backend/app/tests/test_models.py
import pytest
from pydantic import ValidationError

from app.models import (
    CreateOrderRequest, UpdateOrderRequest, Order, OrderItem,
    Mode, order_to_row,
)


def test_mode_literal_accepts_known():
    req = CreateOrderRequest(mode="emergency", language="ja",
                             items=[OrderItem(name="x", qty=1)])
    assert req.mode == "emergency"


def test_mode_literal_rejects_unknown():
    with pytest.raises(ValidationError):
        CreateOrderRequest(mode="unknown", language="ja",
                           items=[OrderItem(name="x", qty=1)])


def test_order_to_row_format():
    order = Order(
        order_id="ord_abc",
        mode="callcenter",
        language="ja",
        customer_label=None,
        items=[OrderItem(name="親子丼", qty=2)],
        notes=None,
        status="pending",
        created_at="2026-05-15T10:00:00Z",
        updated_at="2026-05-15T10:00:00Z",
    )
    row = order_to_row(order)
    assert row[0] == "ord_abc"
    assert "親子丼" in row[5]  # items column
    assert "2" in row[5]
    assert row[3] == "callcenter"
