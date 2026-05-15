import asyncio
from collections import deque
from typing import Any


class BroadcastHub:
    """In-memory pub/sub for order events.

    Keeps a ring buffer of recent events so a freshly connected client can
    be brought up to date. Single-process only — see the spec's scope note.
    """

    def __init__(self, history_size: int = 50) -> None:
        self._clients: set[asyncio.Queue] = set()
        self._history: deque[dict[str, Any]] = deque(maxlen=history_size)

    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    async def publish(self, event: dict[str, Any]) -> None:
        self._history.append(event)
        for queue in list(self._clients):
            await queue.put(event)

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._clients.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._clients.discard(queue)
