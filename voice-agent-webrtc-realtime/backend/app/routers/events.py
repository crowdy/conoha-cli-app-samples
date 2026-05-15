from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/api/events")
async def events_ws(ws: WebSocket) -> None:
    await ws.accept()
    hub = ws.app.state.hub

    # Bring a freshly connected client up to date.
    for event in hub.history():
        await ws.send_json(event)

    queue = hub.subscribe()
    try:
        while True:
            event = await queue.get()
            # If the hub dropped us mid-wait for back-pressure reasons,
            # is_subscribed will be False — stop sending and close.
            if not hub.is_subscribed(queue):
                await ws.close(code=1011, reason="slow consumer")
                return
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(queue)
