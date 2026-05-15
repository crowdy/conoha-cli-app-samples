import json
from typing import Literal

from pydantic import BaseModel

Mode = Literal["emergency", "military", "callcenter"]
Language = Literal["ja", "en", "ko"]
Status = Literal["open", "closed"]


class OrderItem(BaseModel):
    name: str
    qty: int
    note: str | None = None


class Order(BaseModel):
    order_id: str
    created_at: str
    mode: Mode
    customer_label: str | None
    items: list[OrderItem]
    language: Language
    status: Status
    notes: str | None = None


class CreateOrderRequest(BaseModel):
    mode: Mode
    customer_label: str | None = None
    language: Language
    items: list[OrderItem]


class UpdateOrderRequest(BaseModel):
    items: list[OrderItem]
    notes: str | None = None


class SessionRequest(BaseModel):
    mode: str  # validated/normalised by personas.resolve()


def order_to_row(order: Order) -> list[str]:
    """Serialise an Order into the 8-column Google Sheets row layout."""
    return [
        order.order_id,
        order.created_at,
        order.mode,
        order.customer_label or "",
        json.dumps([i.model_dump() for i in order.items], ensure_ascii=False),
        order.language,
        order.status,
        order.notes or "",
    ]
