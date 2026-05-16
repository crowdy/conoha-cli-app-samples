# voice-agent-conoha-l4/backend/app/routers/orders.py
import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.models import (
    CreateOrderRequest, Order, RecentOrdersResponse, UpdateOrderRequest,
    order_to_row,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _new_order_id() -> str:
    return "ord_" + uuid.uuid4().hex[:10]


def _broadcast(request: Request, event: dict) -> None:
    asyncio.create_task(request.app.state.broker.broadcast(event))


@router.post("", response_model=Order)
async def create_order(req: CreateOrderRequest, request: Request) -> Order:
    order = Order(
        order_id=_new_order_id(),
        mode=req.mode,
        language=req.language,
        customer_label=req.customer_label,
        items=req.items,
        notes=None,
        status="persisted",
        created_at=_now(),
        updated_at=_now(),
    )
    request.app.state.store.create(order)
    try:
        request.app.state.sheets.append_order(order_to_row(order))
    except Exception:
        request.app.state.store.delete(order.order_id)
        raise HTTPException(status_code=502, detail="sheets append failed")
    _broadcast(request, {"type": "order_added", "order": order.model_dump()})
    return order


@router.patch("/{order_id}", response_model=Order)
async def update_order(order_id: str, req: UpdateOrderRequest, request: Request) -> Order:
    before = request.app.state.store.get(order_id)
    if before is None:
        raise HTTPException(status_code=404, detail="not found")
    after = request.app.state.store.update(order_id, req.items, req.notes)
    try:
        row = request.app.state.sheets.find_row(order_id)
        if row is None:
            raise RuntimeError("sheets row missing")
        request.app.state.sheets.update_row(row, order_to_row(after))
    except Exception:
        request.app.state.store.restore(before)
        raise HTTPException(status_code=502, detail="sheets update failed")
    _broadcast(request, {"type": "order_updated", "order": after.model_dump()})
    return after


@router.post("/{order_id}/close", response_model=Order)
async def close_order(order_id: str, request: Request) -> Order:
    if request.app.state.store.get(order_id) is None:
        raise HTTPException(status_code=404, detail="not found")
    closed = request.app.state.store.close(order_id)
    try:
        row = request.app.state.sheets.find_row(order_id)
        if row is not None:
            request.app.state.sheets.update_row(row, order_to_row(closed))
    except Exception:
        # Sheets sync failure on close is non-fatal — order is already closed in store.
        pass
    _broadcast(request, {"type": "order_closed", "order_id": order_id})
    return closed


@router.get("/recent", response_model=RecentOrdersResponse)
async def recent_orders(request: Request, limit: int = 10) -> RecentOrdersResponse:
    return RecentOrdersResponse(orders=request.app.state.store.recent(limit=limit))
