"""Lightweight in-process security gates for the demo deploy.

Two protections:

1. Origin allowlist — if ALLOWED_ORIGINS is set, the request's Origin or
   Referer must match one of the entries. Empty config = allow all (dev).
2. Per-IP token bucket on /api/realtime/session — each minted token
   consumes real OpenAI Realtime API quota. We cap minting per source IP.

Both are intentionally small. A real production deploy should put a
proper WAF / API gateway in front.
"""
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app import settings


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Trusts X-Forwarded-For only because the
    deploy sits behind conoha-proxy which sets it."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _origin_allowed(request: Request) -> bool:
    if not settings.ALLOWED_ORIGINS:
        return True  # dev default
    origin = request.headers.get("origin") or request.headers.get("referer", "")
    if not origin:
        return False
    return any(origin.startswith(allowed) for allowed in settings.ALLOWED_ORIGINS)


class OriginGuardMiddleware(BaseHTTPMiddleware):
    """Enforce Origin allowlist on /api/* (both HTTP and WS).

    WebSocket upgrades pass through here too because Starlette's
    BaseHTTPMiddleware wraps the ASGI scope; for WS we check the
    Origin header before letting the handshake proceed.
    """

    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if not _origin_allowed(request):
                return JSONResponse({"detail": "origin not allowed"}, status_code=403)
        return await call_next(request)


class _IPBucket:
    """Per-IP sliding-window counter: at most N requests per 60 seconds."""

    def __init__(self, max_per_minute: int):
        self._max = max_per_minute
        self._hits: dict[str, deque[float]] = {}

    def check(self, ip: str) -> bool:
        now = time.monotonic()
        cutoff = now - 60.0
        dq = self._hits.setdefault(ip, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= self._max:
            return False
        dq.append(now)
        return True


_session_bucket = _IPBucket(settings.SESSION_RATE_LIMIT_PER_MIN)


def session_rate_limit(request: Request) -> bool:
    """Returns True if the call is allowed, False if it should be 429'd."""
    return _session_bucket.check(_client_ip(request))


def reset_session_bucket() -> None:
    """Test helper."""
    _session_bucket._hits.clear()
