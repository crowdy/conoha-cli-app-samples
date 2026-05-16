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
