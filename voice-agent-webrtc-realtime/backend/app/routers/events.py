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
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(queue)
