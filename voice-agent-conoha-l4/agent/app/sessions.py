"""Session concurrency registry.

Single-event-loop discipline; no thread safety guarantees. All callers
run on the asyncio event loop, so a threading.Lock would be redundant
and misleading.
"""


class SessionRegistry:
    """Tracks active WebRTC sessions and enforces a global concurrency cap."""

    def __init__(self, max_sessions: int) -> None:
        self._max = max_sessions
        self._ids: set[str] = set()

    def acquire(self, session_id: str) -> bool:
        if session_id in self._ids:
            return True
        if len(self._ids) >= self._max:
            return False
        self._ids.add(session_id)
        return True

    def release(self, session_id: str) -> None:
        self._ids.discard(session_id)

    def rename(self, old: str, new: str) -> bool:
        """Atomically rename a session slot. Returns False if `old` doesn't exist."""
        if old not in self._ids:
            return False
        self._ids.discard(old)
        self._ids.add(new)
        return True

    def count(self) -> int:
        return len(self._ids)
