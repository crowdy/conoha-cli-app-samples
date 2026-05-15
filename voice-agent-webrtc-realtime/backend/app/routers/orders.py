from fastapi import APIRouter, HTTPException, Request

from app.models import (
    CreateOrderRequest,
    Order,
    RecentOrdersResponse,
    UpdateOrderRequest,
    order_to_row,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])


async def _persist_new(request: Request, order: Order) -> None:
    """Append to Sheets; on failure roll the order out of the store."""
    try:
        request.app.state.sheets.append_order(order_to_row(order))
    except Exception as exc:
        request.app.state.store.delete(order.order_id)
        raise HTTPException(status_code=502, detail="sheets append failed") from exc


async def _persist_update(request: Request, order: Order, before: Order) -> None:
    """Update the existing Sheets row; on failure restore the pre-mutation order
    in the in-memory store so the UI and Sheets remain consistent."""
    try:
        row_number = request.app.state.sheets.find_row(order.order_id)
        if row_number is None:
            raise RuntimeError("sheets row not found")
        request.app.state.sheets.update_row(row_number, order_to_row(order))
    except Exception as exc:
        request.app.state.store.restore(before)
        raise HTTPException(status_code=502, detail="sheets update failed") from exc


@router.post("", status_code=201)
async def create_order(req: CreateOrderRequest, request: Request) -> Order:
    order = request.app.state.store.create(
        req.mode, req.customer_label, req.language, req.items
    )
    await _persist_new(request, order)
    await request.app.state.hub.publish(
        {"type": "order_added", "payload": order.model_dump()}
    )
    return order


@router.patch("/{order_id}")
async def update_order(
    order_id: str, req: UpdateOrderRequest, request: Request
) -> Order:
    before = request.app.state.store.get(order_id)
    if before is None:
        raise HTTPException(status_code=404, detail="order not found")
    order = request.app.state.store.update(order_id, req.items, req.notes)
    await _persist_update(request, order, before)
    await request.app.state.hub.publish(
        {"type": "order_updated", "payload": order.model_dump()}
    )
    return order


@router.post("/{order_id}/close")
async def close_order(order_id: str, request: Request) -> Order:
    before = request.app.state.store.get(order_id)
    if before is None:
        raise HTTPException(status_code=404, detail="order not found")
    order = request.app.state.store.close(order_id)
    await _persist_update(request, order, before)
    await request.app.state.hub.publish(
        {"type": "order_closed", "payload": order.model_dump()}
    )
    return order


@router.get("/recent", response_model=RecentOrdersResponse)
async def recent_orders(request: Request, limit: int = 20) -> RecentOrdersResponse:
    return RecentOrdersResponse(orders=request.app.state.store.recent(limit))
