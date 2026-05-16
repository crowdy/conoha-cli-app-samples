# voice-agent-conoha-l4/backend/app/routers/events.py
"""WebSocket fan-out for order events.

Each connection joins an async queue. `broadcast()` enqueues to every
queue; per-connection sender drains its queue. Slow consumers do not
block fast ones because each has its own queue (bounded at 64).

`broadcast` is safe to call from any thread or event loop context:
it schedules puts on the queue's owning loop via call_soon_threadsafe
when called from outside that loop.
"""
import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["events"])


class _LoopQueue:
    """asyncio.Queue bound to a specific event loop for cross-thread safety."""

    def __init__(self, loop: asyncio.AbstractEventLoop, maxsize: int = 64) -> None:
        self._loop = loop
        self._q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)

    def put_threadsafe(self, event: dict) -> None:
        def _put() -> None:
            try:
                self._q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("event queue full, dropping for one client")

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None

        if running is self._loop:
            _put()
        else:
            self._loop.call_soon_threadsafe(_put)

    async def get(self) -> dict:
        return await self._q.get()


class EventBroker:
    def __init__(self) -> None:
        self._queues: set[_LoopQueue] = set()

    def add(self) -> _LoopQueue:
        loop = asyncio.get_running_loop()
        q = _LoopQueue(loop)
        self._queues.add(q)
        return q

    def remove(self, q: _LoopQueue) -> None:
        self._queues.discard(q)

    async def broadcast(self, event: dict) -> None:
        for q in list(self._queues):
            q.put_threadsafe(event)


@router.websocket("/events")
async def events_ws(ws: WebSocket) -> None:
    await ws.accept()
    broker: EventBroker = ws.app.state.broker
    q = broker.add()
    try:
        while True:
            event = await q.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        broker.remove(q)

