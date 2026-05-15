import pytest
from fastapi.testclient import TestClient

from app.broadcast import BroadcastHub
from app.main import create_app
from app.security import reset_session_bucket
from app.store import OrderStore


class FakeSheets:
    """Stand-in for app.sheets.SheetsClient. Matches its public interface."""

    def __init__(self) -> None:
        self.appended: list[list[str]] = []
        self.updated: list[tuple[int, list[str]]] = []
        self._rows: dict[str, int] = {}
        self.fail = False
        self.fail_update = False

    def append_order(self, row: list[str]) -> None:
        if self.fail:
            raise RuntimeError("sheets down")
        self.appended.append(row)
        self._rows[row[0]] = len(self.appended) + 1

    def find_row(self, order_id: str) -> int | None:
        return self._rows.get(order_id)

    def update_row(self, row_number: int, row: list[str]) -> None:
        if self.fail_update:
            raise RuntimeError("sheets update down")
        self.updated.append((row_number, row))


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """Each test starts with an empty per-IP token bucket."""
    reset_session_bucket()
    yield


@pytest.fixture
def app():
    application = create_app()
    # Pre-seed app.state so lifespan leaves these untouched (no real network).
    application.state.sheets = FakeSheets()
    application.state.hub = BroadcastHub()
    application.state.store = OrderStore()
    return application


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client
