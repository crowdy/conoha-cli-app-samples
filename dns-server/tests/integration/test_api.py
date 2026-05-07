"""End-to-end API tests against a running compose stack."""

import pytest


class TestPostSubdomain:
    async def test_create_simple_a_record(self, client, auth_headers):
        resp = await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["name"] == "tkim.users.example.com"
        assert body["records"] == [
            {"type": "A", "value": "203.0.113.42", "ttl": 300}
        ]

    async def test_rejects_outside_parent_zone(self, client, auth_headers):
        resp = await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 400
        assert "must end with" in resp.json()["detail"]

    async def test_rejects_reserved_label(self, client, auth_headers):
        resp = await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "www.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 400
        assert "reserved" in resp.json()["detail"]

    async def test_missing_token_returns_401(self, client):
        resp = await client.post(
            "/v1/subdomains",
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        assert resp.status_code == 401

    async def test_duplicate_post_returns_409(self, client, auth_headers):
        payload = {
            "name": "tkim.users.example.com",
            "records": [{"type": "A", "value": "203.0.113.42"}],
        }
        first = await client.post("/v1/subdomains", headers=auth_headers, json=payload)
        assert first.status_code == 201
        dup = await client.post("/v1/subdomains", headers=auth_headers, json=payload)
        assert dup.status_code == 409
