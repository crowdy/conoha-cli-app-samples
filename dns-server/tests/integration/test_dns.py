"""End-to-end DNS resolution tests.

Uses dnspython to query the PowerDNS instance bound on localhost:53
(host network mode). Allows ~12 s after each API write for the gpgsql
cache to expire.
"""

import asyncio

import dns.resolver
import pytest

DNS_HOST = "127.0.0.1"
DNS_PORT = 53
PROPAGATE = 12  # PowerDNS gpgsql cache default 10s + slack


def _resolver():
    r = dns.resolver.Resolver(configure=False)
    r.nameservers = [DNS_HOST]
    r.port = DNS_PORT
    r.timeout = 3
    r.lifetime = 5
    return r


class TestDnsResolution:
    async def test_a_record_resolves(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await asyncio.sleep(PROPAGATE)
        ans = _resolver().resolve("tkim.users.example.com", "A")
        assert {r.to_text() for r in ans} == {"203.0.113.42"}

    async def test_cname_resolves(self, client, auth_headers):
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
        await asyncio.sleep(PROPAGATE)
        ans = _resolver().resolve("blog.tkim.users.example.com", "CNAME")
        assert any("tkim.users.example.com" in r.to_text() for r in ans)

    async def test_delete_yields_nxdomain(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": "tkim.users.example.com",
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await asyncio.sleep(PROPAGATE)
        await client.delete(
            "/v1/subdomains/tkim.users.example.com", headers=auth_headers
        )
        await asyncio.sleep(PROPAGATE)
        with pytest.raises(dns.resolver.NXDOMAIN):
            _resolver().resolve("tkim.users.example.com", "A")
