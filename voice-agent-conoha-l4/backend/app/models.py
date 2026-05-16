# voice-agent-conoha-l4/backend/app/models.py
from typing import Literal

from pydantic import BaseModel, Field

Mode = Literal["emergency", "military", "callcenter"]
Language = Literal["ja", "en", "ko"]
OrderStatus = Literal["pending", "persisted", "closed", "error"]


class OrderItem(BaseModel):
    name: str
    qty: int = Field(ge=1)
    note: str | None = None


class CreateOrderRequest(BaseModel):
    mode: Mode
    language: Language
    customer_label: str | None = None
    items: list[OrderItem]


class UpdateOrderRequest(BaseModel):
    items: list[OrderItem]
    notes: str | None = None


class Order(BaseModel):
    order_id: str
    mode: Mode
    language: Language
    customer_label: str | None
    items: list[OrderItem]
    notes: str | None
    status: OrderStatus
    created_at: str
    updated_at: str


class RecentOrdersResponse(BaseModel):
    orders: list[Order]


def order_to_row(order: Order) -> list[str]:
    items_str = ", ".join(f"{i.name} x{i.qty}" for i in order.items)
    return [
        order.order_id,
        order.created_at,
        order.updated_at,
        order.mode,
        order.language,
        items_str,
        order.customer_label or "",
        order.notes or "",
        order.status,
    ]
