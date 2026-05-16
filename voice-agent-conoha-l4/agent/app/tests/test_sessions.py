import asyncio

import pytest

from app.sessions import SessionRegistry


def test_acquire_releases_under_cap():
    reg = SessionRegistry(max_sessions=2)
    assert reg.acquire("s1") is True
    assert reg.acquire("s2") is True
    assert reg.acquire("s3") is False
    reg.release("s1")
    assert reg.acquire("s3") is True


def test_acquire_same_id_idempotent():
    reg = SessionRegistry(max_sessions=2)
    assert reg.acquire("s1") is True
    assert reg.acquire("s1") is True  # same id, no new slot consumed
    assert reg.count() == 1


def test_rename_swaps_ids():
    reg = SessionRegistry(max_sessions=2)
    reg.acquire("a")
    assert reg.rename("a", "b") is True
    assert reg.count() == 1
    assert reg.acquire("a")  # original id is free


def test_close_releases_slot():
    """C-1: release() called by WebRTCNegotiator.close() frees the slot."""
    reg = SessionRegistry(max_sessions=1)
    assert reg.acquire("sess-1") is True
    assert reg.acquire("sess-2") is False  # cap reached

    # Simulate what WebRTCNegotiator.close() does via release_cb
    reg.release("sess-1")

    assert reg.count() == 0
    assert reg.acquire("sess-2") is True  # slot now available


def test_release_unknown_id_is_noop():
    """Releasing a non-existent id must not raise."""
    reg = SessionRegistry(max_sessions=2)
    reg.release("nonexistent")  # should not raise
    assert reg.count() == 0


@pytest.mark.asyncio
async def test_timeout_enforcement(monkeypatch):
    """C-2: _enforce_timeout closes the session after SESSION_MAX_DURATION_SEC."""
    from app import settings as s
    monkeypatch.setattr(s, "SESSION_MAX_DURATION_SEC", 0)

    closed: list[str] = []

    from app.transport import WebRTCNegotiator
    neg = WebRTCNegotiator(release_cb=lambda sid: closed.append(sid))

    # Inject a fake pc entry so close() can find something to act on
    class _FakePC:
        connectionState = "new"
        async def close(self): pass

    sid = "fake-sid"
    neg._pcs[sid] = _FakePC()
    neg._pipelines[sid] = None

    # Schedule the timeout task directly
    task = asyncio.create_task(neg._enforce_timeout(sid))
    neg._timeout_tasks[sid] = task

    # Give the event loop a moment to let the 0-second sleep expire
    await asyncio.sleep(0.05)

    assert sid not in neg._pcs, "session should have been closed by timeout"
    assert sid in closed, "release_cb should have been called"
