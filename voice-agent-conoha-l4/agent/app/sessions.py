import threading


class SessionRegistry:
    """Tracks active WebRTC sessions and enforces a global concurrency cap."""

    def __init__(self, max_sessions: int) -> None:
        self._max = max_sessions
        self._lock = threading.Lock()
        self._ids: set[str] = set()

    def acquire(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._ids:
                return True
            if len(self._ids) >= self._max:
                return False
            self._ids.add(session_id)
            return True

    def release(self, session_id: str) -> None:
        with self._lock:
            self._ids.discard(session_id)

    def count(self) -> int:
        return len(self._ids)
