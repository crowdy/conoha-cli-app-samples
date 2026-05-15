import asyncio
from collections import deque
from typing import Any

_PER_CLIENT_QUEUE_SIZE = 64


class BroadcastHub:
    """In-memory pub/sub for order events.

    Keeps a ring buffer of recent events so a freshly connected client can
    be brought up to date. Single-process only — see the spec's scope note.

    Each subscriber gets a bounded queue. If a subscriber falls behind
    (e.g. a phone with a locked screen on a flaky network), it is dropped
    rather than allowed to grow unboundedly. The WS handler checks
    `is_subscribed()` to detect drop-on-overflow and close the socket.
    """

    def __init__(self, history_size: int = 50) -> None:
        self._clients: set[asyncio.Queue] = set()
        self._history: deque[dict[str, Any]] = deque(maxlen=history_size)

    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    async def publish(self, event: dict[str, Any]) -> None:
        self._history.append(event)
        for queue in list(self._clients):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Slow subscriber: drop it. The WS handler detects this
                # via is_subscribed() and closes its socket.
                self._clients.discard(queue)

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=_PER_CLIENT_QUEUE_SIZE)
        self._clients.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._clients.discard(queue)

    def is_subscribed(self, queue: asyncio.Queue) -> bool:
        return queue in self._clients
