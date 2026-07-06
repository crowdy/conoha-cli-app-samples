"""Lock the auth-header contract for SlurmClient.

slurmrestd's rest_auth/jwt plugin rejects requests that carry both
X-SLURM-USER-TOKEN and Authorization: Bearer simultaneously. The
canonical Slurm setup uses only X-SLURM-USER-NAME + X-SLURM-USER-TOKEN.
If a future change reintroduces Authorization: Bearer, every API call
will start returning 401 and only an end-to-end test would catch it —
hence this unit test.
"""
from slurm_client.http import SlurmClient


def test_session_headers_only_x_slurm():
    client = SlurmClient(endpoint="https://x.example.com",
                         token="abc", user="slurm")
    headers = client._session.headers
    assert headers["X-SLURM-USER-NAME"] == "slurm"
    assert headers["X-SLURM-USER-TOKEN"] == "abc"
    assert headers["Accept"] == "application/json"
    # Critical: do not send Authorization: Bearer alongside X-SLURM-USER-TOKEN.
    assert "Authorization" not in headers


def test_endpoint_trailing_slash_stripped():
    client = SlurmClient(endpoint="https://x.example.com/",
                         token="t", user="slurm")
    assert client.endpoint == "https://x.example.com"


def test_url_helper_builds_versioned_path():
    client = SlurmClient(endpoint="https://x.example.com",
                         token="t", user="slurm")
    assert client._url("slurm", "/jobs/") == \
        "https://x.example.com/slurm/v0.0.42/jobs/"
    assert client._url("slurmdb", "/jobs/") == \
        "https://x.example.com/slurmdb/v0.0.42/jobs/"
