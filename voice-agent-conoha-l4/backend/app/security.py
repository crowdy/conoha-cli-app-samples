# voice-agent-conoha-l4/backend/app/security.py
"""Origin allowlist and per-IP rate limit middleware for /api/*.

Both are intentionally small in-process gates. A production deploy should
use a proper WAF / API gateway in front.
"""
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app import settings


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _origin_allowed(request: Request) -> bool:
    if not settings.ALLOWED_ORIGINS:
        return True
    origin = request.headers.get("origin") or request.headers.get("referer", "")
    if not origin:
        return False
    return any(origin == allowed or origin.startswith(allowed + "/")
               for allowed in settings.ALLOWED_ORIGINS)


class OriginGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if not _origin_allowed(request):
                return JSONResponse({"detail": "origin not allowed"}, status_code=403)
        return await call_next(request)


class _IPBucket:
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

    def reset(self) -> None:
        self._hits.clear()


_orders_bucket = _IPBucket(settings.ORDERS_RATE_LIMIT_PER_MIN)


def reset_orders_bucket() -> None:
    _orders_bucket._max = settings.ORDERS_RATE_LIMIT_PER_MIN
    _orders_bucket.reset()


class OrdersRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/api/orders") and request.method != "GET":
            if not _orders_bucket.check(_client_ip(request)):
                return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        return await call_next(request)
