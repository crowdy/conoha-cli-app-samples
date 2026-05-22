"""In-memory job manager with per-job SSE event queue."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable


PipelineFn = Callable[[Callable[..., Awaitable[None]], Path], Awaitable[None]]


@dataclass
class JobEvent:
    stage: str
    t_ms: int
    message: str
    payload: dict | None = None


@dataclass
class JobState:
    id: str
    status: str = "queued"  # queued | running | done | error
    started_at: float = field(default_factory=time.monotonic)
    last_event_at: float = field(default_factory=time.monotonic)
    error: str | None = None
    work_dir: Path | None = None


class JobManager:
    def __init__(self, work_root: Path, max_concurrent: int = 2):
        self._root = work_root
        self._root.mkdir(parents=True, exist_ok=True)
        self._states: dict[str, JobState] = {}
        self._queues: dict[str, asyncio.Queue[JobEvent | None]] = {}
        self._buffers: dict[str, deque[JobEvent]] = {}
        self._sem = asyncio.Semaphore(max_concurrent)

    def state(self, job_id: str) -> JobState | None:
        return self._states.get(job_id)

    def result_path(self, job_id: str) -> Path:
        return self._root / job_id / "result.vtu"

    async def submit_with_pipeline(self, spec: dict, pipeline: PipelineFn) -> str:
        job_id = uuid.uuid4().hex[:12]
        work_dir = self._root / job_id
        work_dir.mkdir(parents=True, exist_ok=True)
        st = JobState(id=job_id, work_dir=work_dir)
        self._states[job_id] = st
        self._queues[job_id] = asyncio.Queue()
        self._buffers[job_id] = deque(maxlen=32)
        await self._emit(job_id, "queued", "accepted")
        asyncio.create_task(self._run(job_id, pipeline))
        return job_id

    async def _run(self, job_id: str, pipeline: PipelineFn) -> None:
        st = self._states[job_id]
        try:
            async with self._sem:
                st.status = "running"
                await pipeline(
                    lambda stage, msg, payload=None: self._emit(job_id, stage, msg, payload),
                    st.work_dir,
                )
            st.status = "done"
            await self._emit(job_id, "done", "ok")
        except Exception as exc:  # noqa: BLE001
            st.status = "error"
            st.error = str(exc)
            await self._emit(job_id, "error", str(exc), payload={"cause": type(exc).__name__})
        finally:
            await self._queues[job_id].put(None)  # close marker

    async def _emit(self, job_id: str, stage: str, message: str, payload: dict | None = None) -> None:
        ev = JobEvent(
            stage=stage,
            t_ms=int((time.monotonic() - self._states[job_id].started_at) * 1000),
            message=message,
            payload=payload,
        )
        self._buffers[job_id].append(ev)
        self._states[job_id].last_event_at = time.monotonic()
        await self._queues[job_id].put(ev)

    async def events(self, job_id: str) -> AsyncIterator[JobEvent]:
        if job_id not in self._queues:
            return
        # Replay buffer while draining matching queue entries to avoid duplicates
        buffered = list(self._buffers[job_id])
        for _ in range(len(buffered)):
            try:
                self._queues[job_id].get_nowait()
            except asyncio.QueueEmpty:
                break
        for ev in buffered:
            yield ev
        while True:
            ev = await self._queues[job_id].get()
            if ev is None:
                return
            yield ev

    async def reap_expired(self, ttl_seconds: int) -> int:
        """Delete job dirs whose last_event is older than ttl_seconds. Return count."""
        import shutil
        now = time.monotonic()
        gone = 0
        for jid, st in list(self._states.items()):
            if now - st.last_event_at > ttl_seconds:
                if st.work_dir and st.work_dir.exists():
                    shutil.rmtree(st.work_dir, ignore_errors=True)
                self._states.pop(jid, None)
                self._queues.pop(jid, None)
                self._buffers.pop(jid, None)
                gone += 1
        return gone
