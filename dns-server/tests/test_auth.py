"""Auth tests using bcrypt against an in-memory token store."""

import bcrypt
import pytest

from api.auth import verify_token, AuthError


def _hash(token: str) -> str:
    return bcrypt.hashpw(token.encode(), bcrypt.gensalt()).decode()


class _FakeStore:
    def __init__(self, rows):
        self._rows = rows

    async def fetch_all(self):
        return self._rows


@pytest.mark.asyncio
async def test_verify_token_returns_id_for_valid():
    store = _FakeStore([{"id": 1, "token_hash": _hash("secret")}])
    token_id = await verify_token("secret", store)
    assert token_id == 1


@pytest.mark.asyncio
async def test_verify_token_raises_on_unknown():
    store = _FakeStore([{"id": 1, "token_hash": _hash("secret")}])
    with pytest.raises(AuthError):
        await verify_token("wrong", store)


@pytest.mark.asyncio
async def test_verify_token_raises_on_empty_store():
    store = _FakeStore([])
    with pytest.raises(AuthError):
        await verify_token("anything", store)
