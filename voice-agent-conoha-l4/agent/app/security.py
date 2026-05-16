"""Origin allowlist and per-IP rate limit on /offer."""
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
    """Apply only to /offer (the only endpoint that consumes GPU)."""

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/offer":
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


_offer_bucket = _IPBucket(settings.OFFER_RATE_LIMIT_PER_MIN)


def reset_offer_bucket() -> None:
    _offer_bucket._max = settings.OFFER_RATE_LIMIT_PER_MIN
    _offer_bucket.reset()


class OfferRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/offer" and request.method == "POST":
            if not _offer_bucket.check(_client_ip(request)):
                return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
        return await call_next(request)
