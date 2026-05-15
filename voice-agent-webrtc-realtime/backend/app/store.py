from collections import OrderedDict
from datetime import datetime, timezone
from uuid import uuid4

from app.models import Language, Mode, Order, OrderItem


class OrderStore:
    """In-memory order store. Google Sheets is the durable copy;
    this is the fast path for update/close/recent lookups."""

    def __init__(self) -> None:
        self._orders: "OrderedDict[str, Order]" = OrderedDict()

    def create(
        self,
        mode: Mode,
        customer_label: str | None,
        language: Language,
        items: list[OrderItem],
    ) -> Order:
        order = Order(
            order_id="ord_" + uuid4().hex[:16],
            created_at=datetime.now(timezone.utc).isoformat(),
            mode=mode,
            customer_label=customer_label,
            items=items,
            language=language,
            status="open",
            notes=None,
        )
        self._orders[order.order_id] = order
        return order

    def get(self, order_id: str) -> Order | None:
        return self._orders.get(order_id)

    def update(
        self, order_id: str, items: list[OrderItem], notes: str | None
    ) -> Order:
        order = self._orders[order_id]
        updated = order.model_copy(update={"items": items, "notes": notes})
        self._orders[order_id] = updated
        return updated

    def close(self, order_id: str) -> Order:
        order = self._orders[order_id]
        updated = order.model_copy(update={"status": "closed"})
        self._orders[order_id] = updated
        return updated

    def delete(self, order_id: str) -> None:
        self._orders.pop(order_id, None)

    def recent(self, limit: int) -> list[Order]:
        return list(self._orders.values())[-limit:]
