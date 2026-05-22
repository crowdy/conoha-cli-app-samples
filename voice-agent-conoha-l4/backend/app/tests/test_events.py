# voice-agent-conoha-l4/backend/app/tests/test_events.py
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.events import EventBroker, router


@pytest.fixture
def app():
    a = FastAPI()
    a.state.broker = EventBroker()
    a.include_router(router)
    return a


def test_ws_receives_broadcast(app):
    with TestClient(app) as client:
        with client.websocket_connect("/api/events") as ws:
            # broadcast is now synchronous — call it directly
            app.state.broker.broadcast({"type": "order_added", "order_id": "x"})
            msg = ws.receive_json()
            assert msg == {"type": "order_added", "order_id": "x"}
