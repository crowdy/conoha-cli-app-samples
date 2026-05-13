"""Thin requests-based wrapper around the slurmrestd v0.0.42 endpoints."""
from __future__ import annotations

from typing import Any, Optional

import requests

API_VERSION = "v0.0.42"
DEFAULT_TIMEOUT = 30


class SlurmAPIError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"slurmrestd {status}: {message}")
        self.status = status


class SlurmClient:
    def __init__(self, endpoint: str, token: str, user: str,
                 timeout: int = DEFAULT_TIMEOUT):
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.user = user
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "X-SLURM-USER-NAME": user,
            "X-SLURM-USER-TOKEN": token,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })

    def _url(self, base: str, path: str) -> str:
        return f"{self.endpoint}/{base}/{API_VERSION}{path}"

    def _check(self, r: requests.Response) -> dict[str, Any]:
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400:
            err = (data.get("errors") or [{"description": r.text}])[0]
            raise SlurmAPIError(r.status_code, err.get("description", "unknown"))
        return data

    def health(self) -> bool:
        r = self._session.get(f"{self.endpoint}/openapi/v3",
                              timeout=self.timeout)
        return r.status_code == 200

    def nodes(self) -> dict[str, Any]:
        # Collection endpoints in slurmrestd require a trailing slash.
        r = self._session.get(self._url("slurm", "/nodes/"),
                              timeout=self.timeout)
        return self._check(r)

    def jobs(self, job_id: Optional[int] = None) -> dict[str, Any]:
        path = f"/job/{job_id}" if job_id is not None else "/jobs/"
        r = self._session.get(self._url("slurm", path), timeout=self.timeout)
        return self._check(r)

    def submit(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = self._session.post(self._url("slurm", "/job/submit"),
                               json=payload, timeout=self.timeout)
        return self._check(r)

    def cancel(self, job_id: int) -> dict[str, Any]:
        r = self._session.delete(self._url("slurm", f"/job/{job_id}"),
                                 timeout=self.timeout)
        return self._check(r)

    def history(self, limit: int = 20) -> dict[str, Any]:
        # slurmdbd jobs endpoint; users param filters to current user.
        r = self._session.get(
            self._url("slurmdb", "/jobs/"),
            params={"users": self.user},
            timeout=self.timeout,
        )
        data = self._check(r)
        jobs = data.get("jobs", [])[:limit]
        return {"jobs": jobs}
