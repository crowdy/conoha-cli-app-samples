"""End-to-end DNS resolution tests.

Uses dnspython to query the PowerDNS instance bound on localhost:53
(host network mode). After each API write we poll the resolver until
the gpgsql positive/negative cache expires and the new state appears
(or a timeout is hit), instead of sleeping for a fixed PROPAGATE.
"""

import asyncio

import dns.resolver

from tests.conftest import PARENT_ZONE

DNS_HOST = "127.0.0.1"
DNS_PORT = 53
RESOLVE_TIMEOUT = 60  # cap, must be > PowerDNS negquery-cache-ttl
RESOLVE_INTERVAL = 0.5

TKIM = f"tkim.{PARENT_ZONE}"
BLOG = f"blog.{TKIM}"


def _resolver():
    r = dns.resolver.Resolver(configure=False)
    r.nameservers = [DNS_HOST]
    r.port = DNS_PORT
    r.timeout = 3
    r.lifetime = 5
    return r


async def _poll(predicate, timeout=RESOLVE_TIMEOUT, interval=RESOLVE_INTERVAL):
    """Call predicate() repeatedly until it returns truthy or timeout."""
    deadline = asyncio.get_running_loop().time() + timeout
    last_exc = None
    while asyncio.get_running_loop().time() < deadline:
        try:
            result = predicate()
            if result:
                return result
        except Exception as exc:  # noqa: BLE001 — predicate may raise dns errors
            last_exc = exc
        await asyncio.sleep(interval)
    if last_exc is not None:
        raise last_exc
    raise TimeoutError(f"poll timed out after {timeout}s")


class TestDnsResolution:
    async def test_a_record_resolves(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": TKIM,
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        ans = await _poll(lambda: _resolver().resolve(TKIM, "A"))
        assert {r.to_text() for r in ans} == {"203.0.113.42"}

    async def test_cname_resolves(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": TKIM,
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": BLOG,
                "records": [{"type": "CNAME", "value": f"{TKIM}."}],
            },
        )
        ans = await _poll(lambda: _resolver().resolve(BLOG, "CNAME"))
        assert any(TKIM in r.to_text() for r in ans)

    async def test_delete_yields_nxdomain(self, client, auth_headers):
        await client.post(
            "/v1/subdomains",
            headers=auth_headers,
            json={
                "name": TKIM,
                "records": [{"type": "A", "value": "203.0.113.42"}],
            },
        )
        await _poll(lambda: _resolver().resolve(TKIM, "A"))
        await client.delete(f"/v1/subdomains/{TKIM}", headers=auth_headers)

        def expect_nxdomain():
            try:
                _resolver().resolve(TKIM, "A")
                return False
            except dns.resolver.NXDOMAIN:
                return True

        await _poll(expect_nxdomain)
