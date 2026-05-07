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


class TestGetSubdomain:
    async def test_list_includes_created(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        resp = await client.get("/v1/subdomains", headers=auth_headers)
        assert resp.status_code == 200
        names = [s["name"] for s in resp.json()]
        assert "tkim.users.example.com" in names

    async def test_get_single_returns_records_and_descendants(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "blog.tkim.users.example.com",
                "records": [{"type": "CNAME", "value": "tkim.users.example.com."}],
            },
        )
        resp = await client.get(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "tkim.users.example.com"
        assert "blog.tkim.users.example.com" in body["descendants"]

    async def test_get_unknown_returns_404(self, client, auth_headers):
        resp = await client.get(
            "/v1/subdomains/nope.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 404


class TestPutSubdomain:
    async def test_put_replaces_records(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.1"}],
            },
        )
        resp = await client.put(
            "/v1/subdomains/tkim.users.example.com",
            headers=auth_headers,
            json={"records": [{"type": "A", "value": "203.0.113.2"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["records"] == [
            {"type": "A", "value": "203.0.113.2", "ttl": 300}
        ]

    async def test_put_is_idempotent(self, client, auth_headers):
        body = {"records": [{"type": "A", "value": "203.0.113.7"}]}
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": body["records"],
            },
        )
        first = await client.put(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers, json=body
        )
        second = await client.put(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers, json=body
        )
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["records"] == second.json()["records"]

    async def test_put_creates_if_absent(self, client, auth_headers):
        resp = await client.put(
            "/v1/subdomains/tkim.users.example.com",
            headers=auth_headers,
            json={"records": [{"type": "A", "value": "203.0.113.42"}]},
        )
        assert resp.status_code == 200


class TestDeleteSubdomain:
    async def test_delete_returns_orphans(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "blog.tkim.users.example.com",
                "records": [{"type": "CNAME", "value": "tkim.users.example.com."}],
            },
        )
        resp = await client.delete(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["deleted"] == "tkim.users.example.com"
        assert "blog.tkim.users.example.com" in body["orphaned_descendants"]

    async def test_delete_unknown_returns_404(self, client, auth_headers):
        resp = await client.delete(
            "/v1/subdomains/nope.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 404

    async def test_after_delete_get_returns_404(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.delete(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        resp = await client.get(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        assert resp.status_code == 404
