import asyncio

import pytest

from app.broadcast import BroadcastHub


def _create(client, name="うどん"):
    return client.post(
        "/api/orders",
        json={
            "mode": "emergency",
            "customer_label": "現場 β",
            "language": "ja",
            "items": [{"name": name, "qty": 1}],
        },
    )


def test_ws_receives_event_published_after_connect(client):
    with client.websocket_connect("/api/events") as ws:
        _create(client, name="うどん")
        evt = ws.receive_json()
        assert evt["type"] == "order_added"
        assert evt["payload"]["items"][0]["name"] == "うどん"


def test_ws_replays_history_on_connect(client):
    _create(client, name="そば")
    with client.websocket_connect("/api/events") as ws:
        evt = ws.receive_json()
        assert evt["type"] == "order_added"
        assert evt["payload"]["items"][0]["name"] == "そば"


def test_two_ws_clients_both_receive(client):
    with client.websocket_connect("/api/events") as ws_a:
        with client.websocket_connect("/api/events") as ws_b:
            _create(client, name="天ぷら")
            assert ws_a.receive_json()["payload"]["items"][0]["name"] == "天ぷら"
            assert ws_b.receive_json()["payload"]["items"][0]["name"] == "天ぷら"


@pytest.mark.asyncio
async def test_slow_subscriber_is_dropped_on_overflow():
    """A subscriber that never drains is dropped once its queue fills,
    so fast subscribers keep receiving."""
    hub = BroadcastHub()
    slow = hub.subscribe()
    fast = hub.subscribe()

    # Fill the slow subscriber past its 64-slot capacity.
    # `fast` drains immediately; `slow` never reads.
    for i in range(70):
        await hub.publish({"type": "noise", "i": i})
        while not fast.empty():
            fast.get_nowait()

    assert not hub.is_subscribed(slow)
    assert hub.is_subscribed(fast)
