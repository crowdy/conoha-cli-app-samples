# voice-agent-conoha-l4/backend/app/store.py
import threading
from datetime import datetime, timezone

from app.models import Order, OrderItem


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class OrderStore:
    """In-memory ordered dict of orders. Thread-safe for the FastAPI
    single-process deployment used by this sample."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._orders: dict[str, Order] = {}

    def create(self, order: Order) -> Order:
        with self._lock:
            self._orders[order.order_id] = order
        return order

    def get(self, order_id: str) -> Order | None:
        return self._orders.get(order_id)

    def update(self, order_id: str, items: list[OrderItem], notes: str | None) -> Order:
        with self._lock:
            cur = self._orders[order_id]
            new = cur.model_copy(update={
                "items": items,
                "notes": notes,
                "status": "persisted",
                "updated_at": _now(),
            })
            self._orders[order_id] = new
            return new

    def close(self, order_id: str) -> Order:
        with self._lock:
            cur = self._orders[order_id]
            new = cur.model_copy(update={"status": "closed", "updated_at": _now()})
            self._orders[order_id] = new
            return new

    def restore(self, order: Order) -> None:
        with self._lock:
            self._orders[order.order_id] = order

    def delete(self, order_id: str) -> None:
        with self._lock:
            self._orders.pop(order_id, None)

    def recent(self, limit: int = 10) -> list[Order]:
        return list(reversed(list(self._orders.values())))[:limit]
